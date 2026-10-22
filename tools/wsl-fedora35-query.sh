#!/usr/bin/env bash
set -x
dnf -q repoquery --whatprovides 'pkg-config(webkit2gtk-4.1)' 2>&1 | head -20
echo "=== fallback: dnf list available ==="
dnf -q list available '*webkit*' 2>&1 | head -30
echo "=== glib2 ==="
dnf -q list available glib2 2>&1 | head -5
echo "=== gtk3-devel ==="
dnf -q list available gtk3-devel 2>&1 | head -5
