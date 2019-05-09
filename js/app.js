function startsWith(self, phrase) {
	return phrase.length && self.length && !self.indexOf(phrase);
}

function endsWith(self, phrase) {
	var last_index_of = self.lastIndexOf(phrase);
	return phrase.length && self.length && ~last_index_of && (last_index_of === self.length - phrase.length);
}

function trim(self) {
	return self.replace(/^\s+|\s+$/g, "");
}

function repeat(self, times) {
	times |= 0;
	if (times < 1) return "";
	var copy = self;
	while (--times) self += copy;
	return self;
}

function stripComments(string) {
	// walk through the line finding the first occurrence of -- not in a string
	var sq = 0,
	dq = 0;
	for (var i = 0; i < string.length; i++) {
		if (string[i] == '\'') sq++;
		if (string[i] == '\"') dq++;
		if (string[i] == '-' && string[i + 1] == '-' && sq % 2 == 0 && dq % 2 == 0) {
			return string.substr(0, i);
		}
	}
	return string;
}

function luaBeautifier(string, indentation) {
	var current_indentation = 0,
	next_indentation = 0;

	return string.split(/\r?\n/).map(function(raw_line) {
		line = trim(stripComments(raw_line));

		current_indentation = next_indentation;

    // Entering in a block
    if (
    	startsWith(line, "local function") ||
    	startsWith(line, "function") ||
    	startsWith(line, "repeat") ||
    	startsWith(line, "while") ||
    	endsWith(line, "then") ||
    	endsWith(line, "do") ||
    	endsWith(line, "{")
    	) next_indentation = current_indentation + 1;

    // Leaving a block
  if (line === "end" || startsWith(line, "}") || startsWith(line, "until")) {
  	current_indentation--;
  	next_indentation = current_indentation;
  }

    // Entering in a block but this line must be pushed back
    if (startsWith(line, "else") || startsWith(line, "elseif")) {
    	current_indentation--;
    	next_indentation = current_indentation + 1;
    }

    var out_line = trim(raw_line);
    return !out_line ? "" : repeat(indentation, current_indentation) + out_line;
  }).join("\n");
}

// optimizer

function traverseAST(object, callsToNonLocals, assignments, i){
	if(!object){
		return
	}

	// check if object can be traversed and do that
	if(object.forEach){
		// object is an array / has forEach
		object.forEach(function(el){
			if(el){
				traverseAST(el, callsToNonLocals, assignments, i+1)
			}
		})
	} else if(typeof object == 'object'){
		// object is just a simple object, try to traverse all keys
		for(var key in object){
			if(object.hasOwnProperty(key)){
				traverseAST(object[key], callsToNonLocals, assignments, i+1)
			}
		}
	}

	// check if object is a function call
	if(object.type == 'CallStatement' || object.type == 'CallExpression'){
		// get expression
		let callExpression = object.type == 'CallStatement' ? object.expression : object

		if(callExpression.base.type == 'MemberExpression' && callExpression.base.indexer == '.' && callExpression.base.base != null) {
			// call to a function in a table (client.log)
			callsToNonLocals.push([callExpression.base.base.name, callExpression.base.identifier.name, i])
		} else if(callExpression.base.type == 'Identifier' && callExpression.base.name.match(/_/g) && (callExpression.base.name.match(/_/g)).length >= 1){
			// most likely call to a already localized function in a table (client_log)
			let parts = callExpression.base.name.split('_')
			callsToNonLocals.push([parts[0], callExpression.base.name.replace(`${parts[0]}_`, ""), i])
		} else if(callExpression.base.type == 'Identifier'){
			// call to a local / global without _ in the name (pcall)
			callsToNonLocals.push([callExpression.base.name ,'', i])
		}
	}

	// check if object is a local variable assignment or function declaration
	if(object.type == 'LocalStatement') {
		object.variables.forEach(function(variable){
			assignments.push([variable.name, i+1])
		})
	} else if(object.type == 'FunctionDeclaration' && object.identifier){
		assignments.push([object.identifier.name, i+1])
	}
}

function optimize(code, localsOnly) {
	let header = "-- local variables for API functions. any changes to the line below will be lost on re-generation"
	let codeIndex = null

	// if code contains our header treat the next line after it as previous localization (ignored on generation, replaced with new version)
	if(code.indexOf(header) != -1){
		// find index of comment
		commentIdx = code.indexOf(header)

		// get code starting from comment
		localsLine = code.slice(commentIdx+1)
		localsLine = localsLine.slice(localsLine.indexOf("\n")+1, localsLine.indexOf("\n", localsLine.indexOf("\n")+1))
		codeIndex = code.indexOf(localsLine)

		code = code.slice(0, codeIndex) + code.slice(codeIndex+localsLine.length)
	}

	// parse code into abstract syntax tree (if required)
	let ast = (code && code.type == 'Chunk') ? code : luaparse.parse(code)

	// traverse AST to find local variable assignments and calls to non-locals
	let callsToNonLocals = [], assignments = []
	traverseAST(ast.body, callsToNonLocals, assignments, 0)

	// ignore all local variable assignments in localization generation (for now, might not work if locals are assigned in blocks)
	let ignored = []
	assignments.forEach(function(assignment){
		ignored.push(assignment[0])
	})

	// generate array of all functions we need to localize
	let localization = []
	callsToNonLocals.forEach(function(call){
		if(call[2] > 0 && !ignored.includes(`${call[0]}_${call[1]}`) && !ignored.includes(call[0])){
			localization.push([call[0], call[1]])
			ignored.push(`${call[0]}_${call[1]}`)
		}
	})

	// sort by alphabet with non-indexed globals (tostring, pcall, type, etc) last
	localization = localization.sort(function(a, b){
		return a[1] == '' ? 1 : a.toString().localeCompare(b.toString())
	})

	// generate left and right side of assignment
	let left = [], right = []

	localization.forEach(function(local){
		if(local[1] == ''){
			left.push(local[0])
			right.push(local[0])
		} else {
			left.push(`${local[0]}_${local[1]}`)
			right.push(`${local[0]}.${local[1]}`)
		}
	})

	// generate final assignment string
	let locals = left.length > 0 ? `local ${left.join(', ')} = ${right.join(', ')}` : ''
	if(localsOnly){
		return locals != '' ? header + locals : ''
	}

	// optimize actual calls by replacing all dot-syntax (client.log) with underscore syntax (client_log)
	localization.forEach(function(local){
		code = code.split(`${local[0]}.${local[1]}`).join(`${local[0]}_${local[1]}`)
	})

	if(codeIndex != null){
		return code.slice(0, codeIndex) + locals + code.slice(codeIndex)
	}

	return `${header}\n${locals}\n\n${code}`
}

// setup ace editor
var editor = ace.edit("editor")
ace.config.setModuleUrl("ace/mode/lua_worker", "/js/ace/lua_worker.js")
editor.setTheme("ace/theme/dracula")
editor.session.setMode("ace/mode/lua")
editor.setOption("showPrintMargin", false)
editor.setOption("cursorStyle", "smooth")
editor.setOption("tabSize", "2")
editor.setOption("useSoftTabs", true)
editor.setOption("enableBasicAutocompletion", true)
editor.setOption("enableLiveAutocompletion", true)

if(document.getElementById("btn-beautify")){
	document.getElementById("btn-beautify").addEventListener("click", function(){
		let cursor = editor.getCursorPosition()
		let result = luaBeautifier(editor.getValue(), "\t")
		editor.setValue(result, -1)
		editor.clearSelection()
		editor.selection.moveTo(cursor.row, cursor.column)
	})
}

if(document.getElementById("btn-optimize")){
	document.getElementById("btn-optimize").addEventListener("click", function(){
		let result = optimize(editor.getValue())
		editor.setValue(result, -1)
		editor.clearSelection()
	})
}

// setup persistence
if(typeof(Storage) !== "undefined") {
	editor.setValue(localStorage.getItem("value") || "", -1)
	editor.selection.moveTo(localStorage.getItem("cursorRow") || 0, localStorage.getItem("cursorColumn") || 0)
	editor.clearSelection()

	function update(){
		localStorage.setItem("value", editor.getValue())

		let cursor = editor.getCursorPosition()
		localStorage.setItem("cursorRow", cursor.row)
		localStorage.setItem("cursorColumn", cursor.column)
	}

	editor.on("change", update)
	editor.on("blur", update)
}
