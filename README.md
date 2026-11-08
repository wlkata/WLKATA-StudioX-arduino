# StudioX Arduino

A WLKATA StudioX extension with its own Blockly workspace for generating Arduino
C++ and uploading it to an external Arduino board. The Arduino sidebar tab has
a block canvas, board and serial-port selectors, Compile/Upload controls, and
code and operation-log panels.

General Blockly, robot, and extension categories remain available. Python, Workflows, and
Python-module categories are hidden from the Arduino toolbox because their
blocks generate Python rather than Arduino C++. Their definitions remain loaded
so copied/imported Python blocks are preserved and reported as unsupported.
Arduino has no category in the main Python toolbox; its definitions remain
loaded for saved workspaces and explicit transfers. Active blocks
that are not supported by the Arduino target receive a warning and red outline;
the Arduino tab lists each problem and selects its block in the Arduino canvas. Compile and
Upload stay unavailable until the workspace is supported. Turning off visual
highlights does not bypass validation. Disabled blocks are omitted.

Selected Python Robot and Accessories blocks convert on paste/import using the
[reviewed mapping](mappings/README.md). Uncertain commands/models stay preserved
and highlighted. General Python blocks, lists, Blockly functions, workflows, and
other extensions' blocks remain unsupported. Arduino C++ includes and
native C++ blocks and generated library function blocks are available.

## Install

1. Use a StudioX build with extension host API version 2 and the workspace frontend APIs documented in
   `docs/extensions/api-v1.md` in the app repository. Older builds show an upgrade
   message in the Arduino tab.
2. In Settings → Extensions → Installed → Install locally → From folder,
   select this repository. Complete Python environment setup and restart StudioX.
   The extension id and installed folder name must be `arduino`.
3. Extension setup prepares its Python environment and immediately downloads
   Arduino CLI 1.5.1 for your OS and CPU. The official archive is checked against
   a pinned SHA-256 checksum before the executable is installed. Existing valid
   tools are reused. A failed download can be retried using Re-setup in Settings
   → Extensions; no restart is needed to perform installation.
4. Restart StudioX to activate the extension. Open Arduino, choose a board, and
   select More → Install board support. This downloads its core and compiler/
   upload tools. Initial choices include Uno, Nano, Nano with the old bootloader,
   and Mega 2560. Boards from other installed cores are also listed, but require
   hardware-specific validation.
5. Select More → Import blocks and open `examples/Blink.xml`. Choose your board
   and serial port, Compile, then Upload.

CLI, board packages, libraries, cache, and builds stay inside the extension's
host-owned persistent folder:

```text
~/.wlkata-studiox/extensions/arduino/.data/toolchain/
  bin/            Managed Arduino CLI, separated by version and platform
  data/           Board packages and their compiler/upload tools
  downloads/      Download cache
  sketchbook/     Arduino libraries
  cache/          Compilation cache
  builds/         Immutable sketches and build output
```

StudioX preserves `.data` during extension replacement, reinstall, and Python
environment resets. Uninstall asks whether to delete saved data and tools.
Bundled and development copies use the same writable user folder. A previous
`~/.wlkata-studiox/arduino` directory is moved here during normal setup if the
new toolchain folder does not yet exist. No tools are written into the app bundle.

An existing CLI may still be selected in More → Arduino CLI settings. Explicit
settings and `STUDIOX_ARDUINO_CLI` take precedence, then the managed executable,
then PATH and common Homebrew locations. `STUDIOX_ARDUINO_HOME` overrides the
runtime toolchain directory for tests. Installing CLI and board support needs
internet; subsequent local builds can reuse the installed tools offline.

If upload reports a busy port, close any serial monitor or StudioX Command
connection holding that Arduino port, then retry. Uploading a sketch does not
require burning a new bootloader. An uploaded sketch runs independently of
StudioX; the app's Python Run/Stop controls do not stop the Arduino program.

## Boards manager

Open More → Boards manager to search board packages that are not installed.
Results show supported board names, latest versions, and installed versions.
Use Refresh index on first use or when looking for new releases, then Install or
Update a package. Newly installed boards appear in the toolbar board selector.
Downloading indexes and packages needs internet; installed boards remain usable
offline. Package operations share the compile/upload lock and can be cancelled.

For additional manufacturers, open Additional board package URLs, enter one
HTTPS index URL per line, and select Save and refresh. Add Arduino-Pico source
fills the index documented by the Arduino-Pico project; save it to enable that
catalog. The standard Arduino catalog also contains Pico support. Finding or
installing a package does not connect to hardware. Pico first-upload/BOOTSEL and
USB permissions still depend on the selected core; physical Pico upload has not
been tested by this extension.

## Independent workspace

The Arduino canvas always contains protected Setup (run once) and Loop (repeat
forever) blocks. They cannot be deleted or duplicated. This editor is separate
from the main Blockly canvas.
Use Import from Blockly to append a snapshot of the current main workspace.
Later edits on either side do not change the other side. Repeated imports append
another copy of the instructions inside the existing Setup/Loop blocks; use
Undo to remove an import. Ordinary pasted statement stacks append to Setup.

Copy and Paste work between the main Blockly and Arduino editors, including
main-editor multi-selections. Pasted blocks receive new ids and variables are
matched by name and type. Importing and pasting do not alter the source blocks.

Arduino has its own Undo/Redo, selection, warnings, and generated code. Unsupported
blocks are highlighted only in Arduino. Its workspace saves locally after edits
and restores when StudioX starts again. More → Save blocks exports a JSON file;
More → Import blocks appends JSON, XML, or legacy `.blockly` files. Clear Arduino
workspace removes instructions while keeping Setup and Loop, and can be undone.
It affects only this editor. If recovery needs a missing block definition,
the original saved data is preserved until the user explicitly clears it.

## Python robot blocks

Paste or import a Python Blockly workspace to convert reviewed Robot and
Accessories blocks into native WLKATA Arduino calls. Setup robot becomes a corresponding class
variable declaration followed by init(). Transport configuration is separate.
Robot and Accessories toolbox entries also create these native Arduino blocks
directly when dragged. Computer/simulated ports are not used as constructor values.
Selected commands can bind to an existing, clearly identified robot declaration.

The mapping table, audited signatures, pending operations, and model limitations
are kept in [mappings/README.md](mappings/README.md) and
[mappings/robot-blocks.json](mappings/robot-blocks.json). Joint moves use Arduino's
`moveJoints()` behavior (G01), including when copied from Python Blockly.
Conveyor moves remain pending because their G-code/mode semantics differ.
Python's combined E4 / MT4 model also requires confirmation.

## Basic blocks

| Area | Supported |
| --- | --- |
| Arduino | On start, repeat forever, pin mode, digital write/read, analog read, PWM write, delay, millis, built-in LED, serial begin/print |
| Logic | Booleans, comparisons, AND/OR, NOT, ternary expression |
| Loops | Repeat, while/until, numeric for loop, break/continue inside an actual loop |
| Math | Numbers, arithmetic/power, modulo, square root, absolute/negative, logarithms/exponentials, rounding, finite built-in constants |
| Variables | Get, set, numeric change; one inferred number, boolean, text, or library class type per variable |
| Text | Literals, join, append, length, empty check, print to Serial |

Setup generates `setup()` and runs once; Loop generates `loop()` and repeats.
Both are present from the start, so there is no Program toolbox category or
manual insert action. Their bodies, positions, and undo history remain editable.
Standalone value blocks must be connected before compiling. Break/continue must
be inside a Blockly loop, not directly inside the Arduino Loop entry block.

Variables are initialized to 0, false, or empty text, and keep one inferred type. Library object variables receive their class type
from an explicit class declaration connected to the standard set variable block.
Numbers use Arduino `double` (on classic AVR boards this has float precision),
booleans use `bool`, and text uses Arduino `String`. Python's arbitrary-size
integers and dynamic type changes are not emulated. Text is encoded as UTF-8.
Library call and parameter checks derive their categories from the declared C++
types, including fixed-width integers and Arduino's `boolean` alias. Numeric and
Boolean values can be compared using C++ scalar promotions, so `int8_t != 0` and
`boolean != 0` are valid comparisons. Other input sockets remain typed. Saved
blocks recompute these categories when loaded, and refreshed headers replace
saved signatures from the same library without mixing classes with equal names.
The toolbox follows BlockFactory's category/block order for existing equivalents.
A horizontal divider separates shared Blockly categories from the top-level
I/O, Timing, Serial, and Libraries / C++ categories. Additional blocks keep their
relative order after the equivalents, and library/header nesting stays intact. I/O blocks
include named pins (`13`, `A0`), digital HIGH/LOW values, condition-driven digital
writes, and buzzer tone/stop-tone controls, alongside pin mode, digital reads and
writes, analog reads, and PWM. Value inputs have editable defaults. Pin labels,
PWM capability, and tone support depend on the selected board.

PWM values are clamped to 0–255; use a PWM-capable pin for your board.
Serial output defaults to 9600 baud unless you add an explicit serial begin
block. The Serial tab displays output from the selected port at the chosen baud rate.

Arduino text blocks interpret named escape sequences before generating C++:

| Type in the text block | Result |
| --- | --- |
| `\t` | Tab |
| `\n` | Newline |
| `\r` | Carriage return |
| `\\` | Literal backslash |
| `\\t` | Literal text `\t` |

This applies to Print, Serial print, joined/stored text, and library string
arguments. Alert (`\a`), backspace (`\b`), form feed (`\f`), vertical tab (`\v`),
escaped quotes (`\"`, `\'`), and NUL (`\0`) are also recognized. NUL terminates
ordinary C strings/Arduino String construction. Other sequences stay literal.
Use doubled backslashes in paths, such as `C:\\temp\\file.txt`. Workspace fields
keep exactly what you typed; decoding happens only when generating Arduino code.

Every active block is checked, including nested inputs. Unsupported blocks,
missing values, type conflicts, duplicate entry blocks, and invalid loop-flow
blocks produce diagnostics. Code preview is available for inspection even when
invalid, but it cannot be compiled or uploaded through the UI until corrected.
Existing Python code generation is unchanged. Running Arduino blocks through
Python reports that they must be compiled from the Arduino tab.

## Arduino libraries and C++

More → Libraries opens the Library manager. Search the Arduino library catalog,
choose a version, and install it with its dependencies. Installed shows the
libraries in this extension's sketchbook. Refresh index fetches updated catalog
metadata. Library installation shares the operation lock with board installation,
compilation, and upload; a package change invalidates the previous Upload result.
Libraries and caches stay in `.data/toolchain`, separate from Arduino IDE.

For a downloaded or custom library, use Install locally → From folder or From ZIP.
Select the actual library folder, or a ZIP containing one library. Modern
`library.properties`/`src` layouts and legacy header-based libraries are accepted.
GitHub ZIP wrapper folders are supported. The source is copied into a temporary
snapshot, installed into the extension's sketchbook through Arduino CLI, and left
unchanged. Temporary files are removed after success, failure, or cancellation.
Local installation does not permanently enable ZIP/Git installs in CLI settings.
Install any additional dependencies separately if they are not already present.

Choose Add include on an installed library to insert its advertised header(s) as
blocks. The manual header field also supports built-in headers such as `Wire.h`.
Existing include blocks are reused rather than duplicated. An include block
emits `#include <Header.h>` before global declarations; it does not download a
library itself. Include blocks are portable with saved/copied workspaces.

Arduino → Libraries / C++ groups installed libraries by library name and then
header file. Each header contains a class dropdown for declarations, a function
dropdown for free/static functions, a variable-method block, and a constant
dropdown when applicable. Selecting a function or overload updates its parameter
inputs. Void calls are statements; returned values connect to value inputs.
A returning function can also be changed to a statement through its context menu.
Installing a library or changing the board refreshes the browser, including
libraries supplied by the board core. Manage libraries is in the same group.

For Servo, open Servo → Servo.h, use Variables → set to create a variable, and
connect the class Servo() value. This declares `Servo v_servo;` before Setup.
The Variables category also has a type value for primitive declarations, such as
set pin to type int, which produces `int v_pin = 0;`. Set boolean and text variables
to type bool and String. Later ordinary set blocks assign values to these variables.

Variables → **address of** returns a pointer to the selected variable. For example,
declare `red`, `green`, `blue`, and `clear` with type `uint16_t`, then connect their
address blocks to the four `getRGBC` inputs. This generates
`v_sensor.getRGBC(&v_red, &v_green, &v_blue, &v_clear);`. The declaration must match
the library's pointer type; an ordinary inferred number uses `double`, whose
address cannot be passed as `uint16_t *`. Arduino's compiler checks the pointer
types. Addresses follow variable renames and survive files and clipboard copies.

The generated `v_` prefix separates Blockly variables from C++ keywords and
Arduino/library names such as `setup`, `loop`, `Serial`, and `Wire`. The visible
variable remains `red`; its generated identifier is `v_red`, so its address is
`&v_red`. Address blocks resolve that identifier automatically.

Use Variables → call variable method, select the declared servo variable, then
choose attach for Setup or write for Loop. The menu contains that variable's
class methods. Parameter inputs follow the selected method/overload. Renaming
the variable updates declarations, getters, setters, and calls. A method-call
block is also available in each header's flyout. Predeclared objects such as Wire
can be selected without another declaration. Required primitive arguments have
editable defaults; optional parameters can be expanded. Matching arguments
survive overload changes, and Undo restores removed values.

Types and class values are declaration markers, not runtime function results.
Declare each variable once, at the top level or directly in Setup. Declarations
are global so both Setup and Loop can use them; constructors run before Setup.
Class arguments must be constant values or explicit C++ expressions available
at that point. Runtime inputs such as millis or variable reads are rejected for
global construction. Use methods such as begin/attach in Setup for runtime
initialization. Declarations inside branches or Loop are rejected.

Generated objects are ordinary C++ values. There is no ownership wrapper, hidden
allocation, or reference counting. Normal class assignment follows the class's
C++ assignment operator; it does not create a Python-style shared reference.
Declare another class variable explicitly before assigning to it. The compiler
reports assignment errors for classes that prohibit copying. Existing saved
constructor-call values connected to set variable are treated as declarations.
Menus, signatures, methods, and arguments survive JSON, XML, clipboard, and
recovery, including restoration when the library catalog is offline.

Advanced C++ contains these escape hatches:

- Include library header — top-level `#include`, without quotes or angle brackets.
- Global C++ definition — creates an object or global value before Setup, for
  example `Servo servo;` or `int count = 0;`.
- Run C++ code — performs an action inside Setup or Loop, for example
  `servo.write(90);`.
- C++ value — an expression with a number, boolean, text, or generic C++ result.

Header parsing is syntactic, not a full C++ compiler. Templates, variadic calls,
operators, and deleted functions are disabled with an explanation. Complex
pointer/reference/object parameters require an explicit C++ value or ordinary
object variable. Inherited methods and APIs generated by macros may need
Advanced C++.
Architecture and preprocessor conditions appear in tooltips; the selected board's
compiler determines whether an API is available. Raw C++ syntax and API errors
appear in the operation log. No header code executes on the computer during
inspection. Python imports and workflows remain unsupported in this editor.

## Compile and upload

Upload is available for a valid workspace once a serial port is selected. It
compiles first when needed, then uploads the resulting immutable build. A
successful build is reused when generated C++ and the selected board are the
same. Moving blocks or making other edits that leave generated code unchanged
preserves that build. Compile remains available to explicitly rebuild.

Board/library installation (including local libraries), CLI settings changes,
and a different generated program require a new build. Refreshing indexes alone
does not invalidate it. If code changes or becomes invalid during automatic
compilation, upload stops before flashing; click Upload again for the latest
program. Compilation failure or cancellation never proceeds to upload. Upload
always references a successful compile id bound to its original board and build
files. Only one compile, upload, or package operation runs at a time; Cancel
terminates its CLI process tree. Failed jobs retain logs. Nothing is uploaded or
connected when the extension or tab starts.

The extension backend uses Arduino CLI argument arrays without a shell.
`requirements.txt` installs the Tree-sitter C++ header parser. StudioX supplies
Flask and flask-cors when preparing backend/setup environments. When updating
an existing installation, use Re-setup in Settings → Extensions and restart
StudioX to install the parser and reload the new block serializers. `contributes.setup.python` points to
`backend/setup.py`, whose `on_setup(ctx)` installs CLI without loading the backend.
Board support is installed separately for the selected board.

## Development

Keep this repository separate from StudioX. For local development, a StudioX
`extensions/arduino` symlink can point to this checkout. A user-installed copy
under `~/.wlkata-studiox/extensions/arduino` takes precedence over that link.
Restart StudioX to reload backend and block definitions.

The frontend injects its own Blockly workspace. It uses
`ExtensionAPI.getWorkspaceToolbox`, `getWorkspaceSnapshot`,
`appendWorkspaceSnapshot`, and the shared block clipboard APIs for explicit
transfers. It does not subscribe to main-workspace changes. Its generator
consumes snapshots of the Arduino workspace. Warnings and block navigation
stay inside that editor. Local recovery uses the extension's data storage.

Repository: https://github.com/wlkata/WLKATA-StudioX-arduino

After the initial code is pushed, this repository can be added to the StudioX
`extensions.json` catalog.

## Serial monitor

The right panel has **Code**, **Log** (build/upload output), and **Serial** tabs.
Choose a serial port in the toolbar, open Serial, set the baud rate to match
`Serial.begin(...)`, and click Connect. Choose a common rate from the dropdown
(including 9600 and 115200), or choose Custom to enter another supported rate.
Changing it while connected reopens the monitor.
The selected baud rate is remembered. Disconnect releases the port; changing the
toolbar port also disconnects the previous monitor.

Serial output streams without waiting for a newline. Text can be selected and
copied while new data arrives. The log follows incoming data when scrolled to the
bottom; scroll up to read earlier output. Clear empties the serial log. The latest
200,000 characters are kept in memory, independently of the operation log.

Upload releases the monitor's port first and reconnects afterward if it was
previously connected and the selected port is unchanged. Compile alone can leave
the monitor running. Ports are opened only by Connect or that upload reconnect.
The monitor uses the extension's managed [Arduino CLI monitor](https://arduino.github.io/arduino-cli/1.5/commands/arduino-cli_monitor/).

## Tests

```sh
node tests/test_compiler.js
node tests/test_cpp_types.js --studiox-root ../blockly
node tests/test_address_of.js --studiox-root ../blockly
node tests/test_text_escapes.js
node tests/test_toolbox.js
node tests/test_scaffold.js
node tests/test_dropdowns.js --studiox-root ../blockly
node tests/test_declarations.js --studiox-root ../blockly
node tests/test_robot_mapping.js
node tests/test_robot_mapping_blocks.js --studiox-root ../blockly
node tests/test_object_variables.js
node tests/test_library_blocks.js --studiox-root ../blockly
node tests/compile_fixture.js /tmp/StudioXSubset.ino
python -B -m unittest discover -s tests -p 'test_*.py'
```

Use a Python with Flask installed, such as the extension's environment. Backend
tests execute a fake CLI and do not flash hardware.
`test_object_variables.js` uses a local `c++` compiler to check plain class declarations,
noncopyable classes, and single initialization without hardware. They cover immutable build
output, board binding, input validation, cancellation, timeout, core installation,
operation locking, bounded history, and HTTP errors.

From the StudioX repository, run the real Blockly/Electron integration test:

```sh
node_modules/.bin/electron ../WLKATA-StudioX-arduino/tests/test_frontend.cjs --studiox-root "$PWD"
```

That test runs two real Blockly workspaces and checks protected Setup/Loop shells, nested library function flyouts,
detached imports, no live synchronization, clipboard transfers both ways, local
undo/redo, diagnostics, keyboard isolation, file import/export, restart recovery,
dynamic function/constant dropdowns, type/class declarations and variable-based method calls, hidden Arduino categories in Python, and stale-build protection. The operation backend is mocked; it does not open
a physical board.

For toolchain validation, `compile_fixture.js` produces a sketch exercising every
supported block kind, including explicit class and primitive declarations. Compile it with Arduino CLI after installing a board core.
The initial implementation was checked with Arduino CLI 1.5.1 and Arduino AVR
core 1.8.8. Physical board upload remains a separate hardware test.

Managed-toolchain tests use fake downloads and cover platform selection, SHA-256
checks, safe extraction, executable verification, reuse, corruption recovery,
failed downloads, and extension-local storage. The real macOS ARM64 CLI archive
was also downloaded and verified during development.
