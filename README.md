# pi-footer

A Pi extension that provides a fancy custom footer with session statistics.

## Features

**Line 1:**
- 📂 Current working directory (with ~ shorthand for home)
- 🌿 Git branch name
- 📝 Session name

**Line 2:**
- 📊 Token usage (↑input ↓output Rcache Wcache)
- 💰 Session cost
- 🧠 Context usage percentage / window size
- 🤖 Current model with thinking level indicator

## Usage

Install the extension:

```bash
ln -s ~/pi-extensions/pi-footer-ext ~/.pi/agent/extensions/pi-footer-ext
```

The footer will automatically display at the bottom of your Pi session.