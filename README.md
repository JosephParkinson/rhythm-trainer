# RT-01

A rhythm trainer, taught via finger drumming. 
Program a pattern of 1–4 bars and test yourself against it on your computer keyboard or a MIDI pad controller. See every hit scored against the grid in milliseconds. Save patterns into folders, chain them into routines, and track improvements over time.

- Allows freedom to practice any pattern you like:
     - drills to practice simple quarter, 8th or 16th notes. Useful for any instrument
     - full drum patterns if you want to practice finger drumming
- build your own practice routines, made by chaining together patterns you've saved
- review progress over time, and see your timing & rhythm measurably improve 

## Install on a Mac

These steps build the desktop app from source and install it in **Applications**. Building it yourself means macOS opens it without security warnings, and the app's **UPDATE** button keeps it up to date.

### 1. Install the tools (once)

Open **Terminal** and run:

```bash
xcode-select --install
```

This installs `git`. If it says they're already installed, carry on.

Then install **Node.js 22 or newer**, either from [nodejs.org](https://nodejs.org) (the LTS installer) or with [Homebrew](https://brew.sh):

```bash
brew install node
```

Check it worked:

```bash
node --version   # v22 or higher
```

### 2. Download the code (once)

```bash
cd ~
git clone https://github.com/JosephParkinson/rhythm-trainer.git
cd rhythm-trainer
```

Keep this folder. The app rebuilds itself from it when it updates.

### 3. Build and install

```bash
npm run update:mac
```

This takes a minute or two the first time. It builds the app for your Mac (Apple silicon or Intel), copies **Rhythm Trainer** into **Applications** and opens it.

### 4. First run

- **Microphone:** macOS asks for microphone access. It's only used by **CALIBRATE** and **LAG TEST** in the settings (⚙). Allow it if you want to use them.
- **MIDI controller:** plug it in before or after opening the app. The **MIDI** light top right turns green when a device is found. Click the light to rescan.
- **Keys and pads:** set them in ⚙. Click a box next to a drum, then press the key or pad you want for it.

## Updating

Click ⚙ → **UPDATE**. The app closes, backs up your data, pulls the latest code, rebuilds, reinstalls and reopens.

Or from Terminal, in the `rhythm-trainer` folder:

```bash
npm run update:mac
```

If an update fails, the old app is left in place and reopened. The log is at `~/Library/Logs/Rhythm Trainer/update.log`, and the previous run's log is `update.prev.log` next to it. Running the update again usually fixes a one-off failure.

## Your data

Patterns, routines, history and settings live in `~/Library/Application Support/Rhythm Trainer`. They're not touched by rebuilding or reinstalling. Every update first copies them to `~/Library/Application Support/Rhythm Trainer Backups` and keeps the last 10.

**To restore a backup:**

1. Quit the app.
2. Copy a dated folder from **Rhythm Trainer Backups** over **Rhythm Trainer**.
3. Reopen the app.

## Alternative: a prebuilt .dmg

If you'd rather not build it, download a `.dmg` from the repository's **Releases** page (if one has been published) and drag the app to **Applications**. The build isn't signed, so the first time macOS will refuse to open it:

1. Right-click the app in **Applications** and choose **Open**, then **Open** again.
2. If there's no **Open** option, go to **System Settings** → **Privacy & Security** and click **Open Anyway**.

A downloaded app has no **UPDATE** button. To get updates that way, follow the steps above instead.

## Uninstall

1. Delete **Rhythm Trainer** from **Applications**.
2. To remove your data too, also delete these two folders in `~/Library/Application Support`:
   - `Rhythm Trainer`
   - `Rhythm Trainer Backups`

## Troubleshooting

| Problem                                    | Fix                                                                                                                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm: command not found`                   | Node.js isn't installed or Terminal needs reopening. Repeat step 1.                                                                                                    |
| The update fails with `ENOTEMPTY`          | Run the update again. If it keeps failing, run `rm -rf node_modules release` in the `rhythm-trainer` folder, then `npm run update:mac`.                                |
| The MIDI light stays off                   | Click it to rescan. Check the controller shows in **Audio MIDI Setup** → **Window** → **Show MIDI Studio**. Try another cable, since some USB cables only carry power. |
| Pads play piano notes                      | Assign the pads to the drums in ⚙. Assigned notes always play drums.                                                                                                   |
| Crackles or dropouts                       | Turn off **LOW LATENCY** in ⚙.                                                                                                                                         |
| Hits are scored consistently early or late | Run **CALIBRATE** in ⚙ with speakers on, not headphones.                                                                                                               |

## Development

```bash
npm install
npm run dev     # dev server in the browser
npm test        # unit tests
npm run build   # typecheck + production build
```
