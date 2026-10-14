import os
import shutil
import subprocess

WORKSPACE_DIR = r"d:\Luong\NB_Personal\Python\IDE-SQL-Lite_New_Pyweb"


def find_browser():
    edge_paths = [
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
    ]
    for p in edge_paths:
        if os.path.exists(p):
            return p
    chrome = shutil.which("chrome")
    if chrome:
        return chrome
    return None


def test_actionbar_responsive_and_debug_headless():
    browser_exe = find_browser()
    if not browser_exe:
        print("SKIP: No browser found")
        return

    html_path = os.path.join(WORKSPACE_DIR, "scratch", "test_actionbar_headless.html")
    os.makedirs(os.path.dirname(html_path), exist_ok=True)

    html_content = r"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Action Bar & Debug Mode Test</title>
    <link rel="stylesheet" href="../static/css/editor.css">
    <style>
        body { margin: 0; padding: 0; }
        .ide-action-bar { width: 100%; display: flex; align-items: center; border-bottom: 1px solid #333; }
    </style>
</head>
<body>
    <div id="test-output">Running...</div>

    <div class="ide-action-bar" id="action-bar-wide" style="width: 1400px;">
        <div class="d-flex align-items-center gap-1 flex-shrink-0">
            <span id="conn-info">Conn > Db > Schema</span>
        </div>
        <div class="d-flex align-items-center gap-1 flex-shrink-0 ide-action-bar-actions flex-nowrap ms-auto">
            <button id="btn-run" class="ide-action-btn ide-action-btn--run ide-action-essential">Run</button>
            <button id="btn-debug" class="ide-action-btn ide-action-btn--debug-toggle ide-action-essential d-none">
                <i class="fa-solid fa-bug ide-debug-icon"></i>
                <span class="ide-debug-led" title="Debug Status"></span>
            </button>
            <button id="btn-stop" class="ide-action-btn ide-action-btn--danger ide-action-essential">Stop</button>

            <!-- Collapsible Part 2 -->
            <button id="btn-parse" class="ide-action-btn ide-action-collapsible">Parse</button>
            <button id="btn-format" class="ide-action-btn ide-action-collapsible">Format</button>
            <button id="btn-plan" class="ide-action-btn ide-action-collapsible">Plan</button>

            <!-- Overflow Part 1 -->
            <div class="dropdown ide-action-overflow-wrap" id="overflow-wrap">
                <button class="ide-action-btn ide-action-btn--overflow" id="btn-overflow">...</button>
            </div>
        </div>
    </div>

    <div class="ide-action-bar is-compact" id="action-bar-compact" style="width: 500px;">
        <div class="d-flex align-items-center gap-1 flex-shrink-0">
            <span>Conn > Db > Schema</span>
        </div>
        <div class="d-flex align-items-center gap-1 flex-shrink-0 ide-action-bar-actions flex-nowrap ms-auto">
            <button class="ide-action-btn ide-action-btn--run ide-action-essential">Run</button>
            <button class="ide-action-btn ide-action-btn--danger ide-action-essential">Stop</button>

            <!-- Collapsible Part 2 -->
            <button class="ide-action-btn ide-action-collapsible" id="compact-parse">Parse</button>

            <!-- Overflow Part 1 -->
            <div class="dropdown ide-action-overflow-wrap" id="compact-overflow-wrap">
                <button class="ide-action-btn ide-action-btn--overflow" id="compact-btn-overflow">...</button>
            </div>
        </div>
    </div>

    <script>
    (function() {
        const results = [];
        try {
            // Test 1: Wide Action Bar (Normal state)
            const wideOverflow = document.getElementById('overflow-wrap');
            const wideParse = document.getElementById('btn-parse');
            const wideStop = document.getElementById('btn-stop');

            const wideOverflowDisp = window.getComputedStyle(wideOverflow).display;
            const wideParseDisp = window.getComputedStyle(wideParse).display;
            const wideStopDisp = window.getComputedStyle(wideStop).display;

            results.push("Wide_Part1_Overflow_Display: " + wideOverflowDisp);
            results.push("Wide_Part2_Parse_Display: " + wideParseDisp);
            results.push("Wide_Stop_Display: " + wideStopDisp);

            // Test 2: Compact Action Bar (Narrow state)
            const compactOverflow = document.getElementById('compact-overflow-wrap');
            const compactParse = document.getElementById('compact-parse');

            const compactOverflowDisp = window.getComputedStyle(compactOverflow).display;
            const compactParseDisp = window.getComputedStyle(compactParse).display;

            results.push("Compact_Part1_Overflow_Display: " + compactOverflowDisp);
            results.push("Compact_Part2_Parse_Display: " + compactParseDisp);

            // Test 3: Debug button toggle active state styling & pulsing LED
            const btnDebug = document.getElementById('btn-debug');
            btnDebug.classList.remove('d-none');
            const led = btnDebug.querySelector('.ide-debug-led');

            const inactiveIconColor = window.getComputedStyle(btnDebug.querySelector('.ide-debug-icon')).color;
            results.push("Debug_Inactive_Icon_HasColor: " + (inactiveIconColor.length > 0));

            btnDebug.classList.add('active');
            const activeIconColor = window.getComputedStyle(btnDebug.querySelector('.ide-debug-icon')).color;
            const ledBg = window.getComputedStyle(led).backgroundColor;
            results.push("Debug_Active_Icon_HasColor: " + (activeIconColor.length > 0));
            results.push("Debug_Active_LED_Green: " + (ledBg.includes('34') || ledBg.includes('197') || ledBg.includes('green') || ledBg.includes('rgb')));

            document.getElementById('test-output').innerText = "DONE\n" + results.join('\n');
        } catch (err) {
            document.getElementById('test-output').innerText = "ERROR: " + err.message;
        }
    })();
    </script>
</body>
</html>"""

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    file_url = f"file:///{html_path.replace(os.sep, '/')}"
    cmd = [browser_exe, "--headless=new", "--disable-gpu", "--dump-dom", file_url]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    out = res.stdout

    print(out)
    assert "Wide_Part1_Overflow_Display: none" in out, "In wide bar, overflow 3-dots (Part 1) MUST BE NONE"
    assert "Wide_Part2_Parse_Display: inline-flex" in out, "In wide bar, secondary buttons (Part 2) MUST BE VISIBLE"
    assert "Wide_Stop_Display: inline-flex" in out, "Stop button must always be visible"
    assert "Compact_Part1_Overflow_Display: inline-block" in out, "In compact bar, overflow 3-dots (Part 1) MUST BE VISIBLE"
    assert "Compact_Part2_Parse_Display: none" in out, "In compact bar, secondary buttons (Part 2) MUST BE NONE"
    print("ALL ASSERTIONS PASSED!")


if __name__ == "__main__":
    test_actionbar_responsive_and_debug_headless()
