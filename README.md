# StudioX Arduino

A WLKATA StudioX extension with its own Blockly workspace for generating Arduino
C++ and uploading it to an external Arduino board. The Arduino sidebar tab has
a block canvas, board and serial-port selectors, Compile/Upload controls, and
code and operation-log panels.

General Blockly, robot, and extension categories remain available. Python and
Python-module categories are hidden from the Arduino toolbox because their
blocks generate Python rather than Arduino C++. Their definitions remain loaded
so copied/imported Python blocks are preserved and reported as unsupported.
The main Blockly toolbox is unchanged. Active blocks
that are not supported by the Arduino target receive a warning and red outline;
the Arduino tab lists each problem and selects its block in the Arduino canvas. Compile and
Upload stay unavailable until the workspace is supported. Turning off visual
highlights does not bypass validation. Disabled blocks are omitted.

This version does not implement robot commands, Python/import blocks, lists,
functions, workflows, or other extensions' blocks. These can be added later
without replacing the editor.

## Install

1. Use a StudioX build with the workspace frontend APIs documented in
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

The Arduino canvas starts empty and is separate from the main Blockly canvas.
Use Import from Blockly to append a snapshot of the current main workspace.
Later edits on either side do not change the other side. Repeated imports append
another copy; use Undo to remove an import.

Copy and Paste work between the main Blockly and Arduino editors, including
main-editor multi-selections. Pasted blocks receive new ids and variables are
matched by name and type. Importing and pasting do not alter the source blocks.

Arduino has its own Undo/Redo, selection, warnings, and generated code. Unsupported
blocks are highlighted only in Arduino. Its workspace saves locally after edits
and restores when StudioX starts again. More → Save blocks exports a JSON file;
More → Import blocks appends JSON, XML, or legacy `.blockly` files. Clear Arduino
workspace affects only this editor. If recovery needs a missing block definition,
the original saved data is preserved until the user explicitly clears it.

## Basic blocks

| Area | Supported |
| --- | --- |
| Arduino | On start, repeat forever, pin mode, digital write/read, analog read, PWM write, delay, millis, built-in LED, serial begin/print |
| Logic | Booleans, comparisons, AND/OR, NOT, ternary expression |
| Loops | Repeat, while/until, numeric for loop, break/continue inside an actual loop |
| Math | Numbers, arithmetic/power, modulo, square root, absolute/negative, logarithms/exponentials, rounding, finite built-in constants |
| Variables | Get, set, numeric change; one inferred number, boolean, or text type per variable |
| Text | Literals, join, append, length, empty check, print to Serial |

Use one Setup (run once) block for `setup()` and one Loop (repeat forever) block
for `loop()`. Find them under Arduino → Program, or click Setup / Loop in the
toolbar to insert whichever entries are missing. That action is undoable and
does not duplicate existing entries. Additional top-level statement stacks run once in `setup()`
in their workspace position order. Standalone value blocks must be connected
before compiling. Break/continue must be inside a Blockly loop, not directly
inside the Arduino repeat forever entry block.

Variables are initialized to 0, false, or empty text, and keep one inferred type.
Numbers use Arduino `double` (on classic AVR boards this has float precision),
booleans use `bool`, and text uses Arduino `String`. Python's arbitrary-size
integers and dynamic type changes are not emulated. Text is encoded as UTF-8.
The Arduino toolbox groups Program, I/O, Timing, and Serial blocks. I/O blocks
include named pins (`13`, `A0`), digital HIGH/LOW values, condition-driven digital
writes, and buzzer tone/stop-tone controls, alongside pin mode, digital reads and
writes, analog reads, and PWM. Value inputs have editable defaults. Pin labels,
PWM capability, and tone support depend on the selected board.

PWM values are clamped to 0–255; use a PWM-capable pin for your board.
Serial output defaults to 9600 baud unless you add an explicit serial begin
block. Simple text/serial output does not include a serial-monitor UI.

Every active block is checked, including nested inputs. Unsupported blocks,
missing values, type conflicts, duplicate entry blocks, and invalid loop-flow
blocks produce diagnostics. Code preview is available for inspection even when
invalid, but it cannot be compiled or uploaded through the UI until corrected.
Existing Python code generation is unchanged. Running Arduino blocks through
Python reports that they must be compiled from the Arduino tab.

## Compile and upload

Compile creates an immutable sketch and build directory. Upload references that
successful compile id and its original board, not arbitrary files or a different
board. Arduino workspace edits and board changes invalidate the Upload button. Edits
made while compilation is running require a new compilation. Upload never
silently recompiles an older snapshot. Only one compile, upload, or core install
runs at a time; Cancel terminates its CLI process tree. Failed jobs retain logs.
No upload or hardware connection runs when the extension or tab starts.

The extension backend uses Arduino CLI argument arrays without a shell.
No `requirements.txt` is needed: StudioX provides Flask and flask-cors when
preparing backend/setup environments. `contributes.setup.python` points to
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

## Tests

```sh
node tests/test_compiler.js
node tests/compile_fixture.js /tmp/StudioXSubset.ino
python -B -m unittest discover -s tests -p 'test_*.py'
```

Use a Python with Flask installed, such as the extension's environment. Backend
tests execute a fake CLI and do not flash hardware. They cover immutable build
output, board binding, input validation, cancellation, timeout, core installation,
operation locking, bounded history, and HTTP errors.

From the StudioX repository, run the real Blockly/Electron integration test:

```sh
node_modules/.bin/electron ../WLKATA-StudioX-arduino/tests/test_frontend.cjs --studiox-root "$PWD"
```

That test runs two real Blockly workspaces and checks an empty Arduino start,
detached imports, no live synchronization, clipboard transfers both ways, local
undo/redo, diagnostics, keyboard isolation, file import/export, restart recovery,
and stale-build protection. The operation backend is mocked; it does not open
a physical board.

For toolchain validation, `compile_fixture.js` produces a sketch exercising every
supported block kind. Compile it with Arduino CLI after installing a board core.
The initial implementation was checked with Arduino CLI 1.5.1 and Arduino AVR
core 1.8.8. Physical board upload remains a separate hardware test.

Managed-toolchain tests use fake downloads and cover platform selection, SHA-256
checks, safe extraction, executable verification, reuse, corruption recovery,
failed downloads, and extension-local storage. The real macOS ARM64 CLI archive
was also downloaded and verified during development.
