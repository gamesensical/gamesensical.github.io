# GameSensical Lua optimizer
Simple web tool that replaces calls to global functions with calls to local functions and generates a single line of local variable assignments at the top

![preview](https://i.imgur.com/6IpEVVM.png)

## How it works:
It properly parses the source code (using luaparse) and traverses the AST, detects calls, checks if they're not already defined in the script somewhere and generates that localization line based on that.
It also finds calls to already localized functions that aren't defined in the script.

Then it also replaces the 'dot-syntax' with the 'underscore-syntax'. you can just give it a already optimized script and remove that massive header and make it only generate the localization line

## Technologies used:
- [materialize.css](https://github.com/Dogfalo/materialize)
- [luaparse](https://github.com/oxyc/luaparse)
- [ace (editor)](https://github.com/ajaxorg/ace) with the 'Darcula' theme
- [lua-beautifier](https://github.com/dptole/lua-beautifier)
