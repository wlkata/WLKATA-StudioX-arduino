# Python Robot/Accessories to Arduino mapping

The executable mapping is `robot-blocks.json` plus `../frontend/robotMapping.js`.
It was reviewed against WLKATA Arduino 3.0.7 in `Downloads/WLKATA`, including
headers, implementation files, and examples; StudioX `js/ui/toolbox.js`,
`js/blocks/setupRobot.js`, `js/blocks/moveRobot.js`, `js/generators/python.js`,
and the bundled `wlkatapython` implementation. Header SHA-256 hashes and the
reviewed API signatures are recorded in the JSON. The robot library source is
not copied into this extension. Install a compatible WLKATA library separately.

## Using the mapping

Copy blocks in Python Blockly, open Arduino, and Paste (toolbar or Ctrl/Cmd+V).
Import from Blockly and JSON/XML/.blockly file imports use the same mapping.
JSON transfers are converted before block loading; XML transfers use a detached
workspace. The source program stays unchanged. Conversion is one undo action.
This translates block structures; it does not translate arbitrary Python text.

Setup robot becomes a standard set variable block containing the corresponding
class value, followed by a variable method call to init(). For Mirobot:

```cpp
Mirobot_UART v_robot;

void setup() {
  v_robot.init();
}
```

There is no extra connection block, bus object, UART selector, or automatic baud
configuration. Configure transport separately through the library if needed.
The Python computer/simulated port is retained as an annotation, not used in
Arduino code. Recovery also upgrades the temporary connection block from the
initial mapping implementation to this plain declaration/initialization form.

The Robot and Accessories toolbox categories use the same mapping to create
native Arduino blocks directly when dragged onto the canvas. They use an
existing declared robot as the initial variable when available; otherwise the
templates use Mirobot/robot until the user declares or selects their variable.
Pending conveyor mappings are labels in the flyout rather than draggable
unsupported Python blocks. Paste/import still retains pending source blocks
with a diagnostic for review.

Mirobot_UART is verified. E4_UART can be mapped when explicitly identified or
when a selected command is pasted against an existing E4 declaration. The
current Python model labelled E4 / MT4 uses MT4_UART; it is deliberately not
renamed to E4_UART. MT4.cpp in the supplied library disagrees with MT4.h and
lacks several advertised arm methods. Harobot_UART and Miromax_UART are absent.

## Reviewed table

| Python block | Arduino function/block | State | Details |
| --- | --- | --- | --- |
| Setup robot (`setup_robot`) | `class declaration + init` | mapped | Create the corresponding class variable and call init(); transport setup remains separate. |
| Home (`robot_homing`) | `homing + waitIdle` | mapped | Includes both calls; preserves the Python homing block wait. |
| Zero (`robot_zero`) | `zero` | mapped | Direct method mapping. |
| Speed (`robot_speed`) | `setMotionSpeed` | mapped | Python emits F, matching setMotionSpeed; motionSpeedRatio emits H and is not equivalent. |
| Write coordinate (`write_coordinate`) | `movePose` | mapped | Preserves all model axes. MOTION 0/1/2 map to MOVEP/MOVEL/JUMP (G00/G01/G05); not MOVEJ, which is 1 in this library. |
| Write angle (`write_angle`) | `moveJoints` | mapped | Use Arduino's native G01 joint-motion behavior; preserve absolute/incremental mode and every model joint value. |
| Wait until idle (`robot_wait_idle`) | `waitIdle` | mapped | Direct method mapping. |
| Send message (`robot_send_msg`) | `sendMsg` | mapped | Append CRLF like Python. Set askEn false to keep the send-only behavior. |
| Delay (`robot_delay`) | `delay` | mapped | Convert seconds to milliseconds. |
| Suction cup (`robot_pump`) | `setEndtPump` | mapped | Preserve mode 0/1/2 -> PWM 0/1000/500. |
| Gripper (`robot_gripper`) | `setEndtGripper` | mapped | Preserve mode 0/1/2 -> PWM 0/40/60; block labels and SDK docstrings differ, so mapping follows actual commands. |
| Three-finger gripper (`robot_three_finger`) | `setEndtPump` | mapped | Python generator calls pump, not gripper. |
| Conveyor (`robot_conveyor`) | `moveExjDist` | pending | Arduino always uses M21/G00 and scales distance by exj_ratio; Python preserves G00/G01. Units/mode need confirmation. |
| Legacy homing child (`robot_homing_wait`) | `parent homing wait` | legacy | The obsolete decorative child has no Python generator output; it is not converted independently. |

Modes 0/1/2 on pump and gripper are preserved from emitted commands. The Python
gripper docstring conflicts with the block labels; both implementations send
PWM 0/40/60, so conversion does not reinterpret open/close. Three-finger blocks
call Python pump and therefore map to setEndtPump. Cartesian mode 2 means
G05, which is JUMP (2) in this library, despite MOVEJ being defined as 1.

Joint-angle blocks deliberately use the Arduino library's `moveJoints()`
implementation (G01), including when pasted from Python's G00-based writeAngle
block. The position mode and joint values are retained. The same conversion
creates Robot toolbox entries for six-joint Mirobot or explicitly declared
four-joint E4 variables. Missing or extra axes still require correction.

Send message appends CRLF because Python sendMsg appends it and Arduino sendMsg
does not. askEn is false for this send-only block; motion APIs keep the target
library’s normal acknowledgment behavior. Homing always includes waitIdle.
Its obsolete decorative WAIT child is consumed only as part of that parent.

Pending/unresolved blocks remain present with an explanatory diagnostic. They
block compilation while enabled. Missing axes are not replaced with zero and
extra axes are not discarded. Values, expressions, control-flow nesting,
variable names, and disabled state are retained. Python function/workflow
scopes and arbitrary Python imports are not converted.

## Tests and limitations

`test_robot_mapping.js` checks plain setup, native toolbox templates, each reviewed
block, model and axis guards,
partial pastes, multiple variables, units/terminators, disabled state, and pending
mappings. `test_robot_mapping_blocks.js` checks real Blockly JSON/XML round trips
and rename binding. `test_frontend.cjs` covers actual workspace import, JSON/XML
clipboard, native Robot/Accessories toolbox creation, warnings, undo, and source
isolation.

The supplied full WLKATA 3.0.7 library still fails to compile in MT4.cpp because
of its header/source mismatches. Mapping validation can compile unchanged
Mirobot/E4/RS485/base sources as a temporary subset, separately from that known
library defect. Physical upload/motion needs validation on the actual wiring.
No changes are made to the downloaded or installed Arduino library.

To add a pending mapping, confirm model identity, G-code/motion modes, units,
and method availability in both the header and implementation. Update the JSON
and converter together and cover the new parameter mapping with a test.
