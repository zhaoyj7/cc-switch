#!/usr/bin/env bash
# 本地模拟"干净克隆 + 按文档顺序构建"：验证 §11.3 ⑨（rust-embed 缺 dist-legacy 会硬编译错误）的解法。
# 沙箱里刻意不放 node_modules / dist / dist-legacy / target，与 CI 拿到的仓库内容一致。
set -uo pipefail

SRC=/d/projects/ccs
DST="$SRC/.ci-sandbox/repo"
DSTWIN='D:\projects\ccs\.ci-sandbox\repo'

say() { echo "[$(date +%H:%M:%S)] $*"; }

rm -rf "$SRC/.ci-sandbox"
mkdir -p "$DST"

say "1/5 复制工作树（排除 .git node_modules dist dist-legacy* target .e2e-home *.log）"
( cd "$SRC" && tar --exclude=./.git --exclude=./node_modules --exclude=./dist \
    --exclude=./dist-legacy --exclude=./dist-legacy-desktop --exclude=./.e2e-home \
    --exclude=./.ci-sandbox --exclude=./src-tauri/target --exclude='*.log' -cf - . ) \
  | ( cd "$DST" && tar -xf - )
st=$?
say "copy-exit=$st files=$(find "$DST" -type f | wc -l)"
[ -e "$DST/dist-legacy" ] && { say "BUG: 沙箱里不该有 dist-legacy"; st=1; }
[ -e "$DST/node_modules" ] && { say "BUG: 沙箱里不该有 node_modules"; st=1; }
[ -e "$DST/dist" ] && say "注意: 沙箱里有 dist（干净克隆不该有）"

say "2/5 pnpm install --frozen-lockfile --offline"
( cd "$DST" && pnpm install --frozen-lockfile --offline )
st=$?
if [ "$st" -ne 0 ]; then
  say "offline 失败($st)，改用在线 install --frozen-lockfile"
  ( cd "$DST" && pnpm install --frozen-lockfile )
  st=$?
fi
say "install-exit=$st"

say "3/5 pnpm build:legacy:web（这一步产出 rust-embed 要的 ../dist-legacy）"
( cd "$DST" && pnpm build:legacy:web )
st=$?
say "web-build-exit=$st"
if [ -d "$DST/dist-legacy" ]; then
  say "dist-legacy 文件数=$(find "$DST/dist-legacy" -type f | wc -l)"
  new=$( (cd "$DST/dist-legacy" && find . -type f -name 'index-*.js' | head -1) )
  say "沙箱 index js = $new md5=$( (cd "$DST/dist-legacy" && md5sum "$new") | cut -d' ' -f1)"
  say "本仓 dist-legacy md5 = $( (cd "$SRC/dist-legacy" && md5sum "$new" 2>/dev/null) | cut -d' ' -f1)"
fi

say "4/5 生成沙箱用的 MSVC cargo wrapper"
# 三个坑（都实测踩过）：
#   - .cmd 必须是 CRLF，LF 版 cmd.exe 会报 "The syntax of the command is incorrect."；
#   - Git Bash 里写 `cmd.exe /c` 会被 MSYS 当成路径转换成 C:\，要写 //c；
#   - heredoc 里的 `>nul` 会被 MSYS 改写成 `>/dev/null`，cmd 里就变成"找不到路径"，所以别重定向。
VCVARS='C:\Program Files\Microsoft Visual Studio\18\VC\Auxiliary\Build\vcvars64.bat'
CARGOBIN='C:\Users\admin\.cargo\bin'
cat > "$SRC/.ci-sandbox/msvc-env.cmd" <<EOF
@echo off
call "$VCVARS"
set PATH=$CARGOBIN;%PATH%
set RUSTUP_TOOLCHAIN=1.95-x86_64-pc-windows-msvc
cd /d $DSTWIN\\src-tauri
cargo %*
set RC=%ERRORLEVEL%
echo WRAPPER-EXIT=%RC%
exit /b %RC%
EOF
sed -i 's/\r\?$/\r/' "$SRC/.ci-sandbox/msvc-env.cmd"
say "wrapper 行数=$(wc -l < "$SRC/.ci-sandbox/msvc-env.cmd") crlf=$(grep -c $'\r$' "$SRC/.ci-sandbox/msvc-env.cmd")"

say "5/6 反向对照：把沙箱的 dist-legacy 移走 → 应当硬编译错误（§11.3 ⑨）"
mv "$DST/dist-legacy" "$DST/dist-legacy.bak"
cmd.exe //c "$(cygpath -w "$SRC/.ci-sandbox/msvc-env.cmd") check --no-default-features --features headless --lib --bin cc-switch-server" \
  > "$SRC/tools/ci-local-negative.log" 2>&1
st=$?
say "negative-exit=$st （期望非 0）"
say "negative 关键报错: $(grep -m1 'does not exist' "$SRC/tools/ci-local-negative.log" || echo '(没找到该行)')"

say "6/6 正向：把 dist-legacy 放回去 → 同一份依赖图下应当编得过"
mv "$DST/dist-legacy.bak" "$DST/dist-legacy"
cmd.exe //c "$(cygpath -w "$SRC/.ci-sandbox/msvc-env.cmd") check --no-default-features --features headless --lib --bin cc-switch-server" \
  > "$SRC/tools/ci-local-positive.log" 2>&1
st2=$?
say "positive-exit=$st2 （期望 0）"
say "sandbox-build-done negative=$st positive=$st2"
# 期望：反向对照必须失败(非 0)，正向必须成功(0)。任一不符就整体失败。
if [ "$st" = "0" ] || [ "$st2" != "0" ]; then
  say "结论不符预期：negative=$st positive=$st2"
  exit 1
fi
exit 0
