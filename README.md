# Serene Focus - Pomodoro Timer Chrome Extension

A minimalistic Pomodoro timer Chrome extension that helps you stay focused and take regular breaks. The extension enforces work and break sessions, helping you maintain productivity and prevent burnout.

## Features

- 🕒 Customizable Pomodoro timer (work/break durations)
- ⏳ Automatic session tracking (4 work sessions = 1 long break)
- 🔔 Desktop notifications for session transitions
- 🔒 Forced break mode to ensure you take your breaks
- 🎨 Clean, calming interface with a meditation-app feel
- 📊 Progress tracking for work sessions
- 🎵 Gentle sound alerts
- 🔄 Automatic state persistence

## Installation

### From Chrome Web Store (Recommended)

1. Visit the [Chrome Web Store listing](#) (coming soon)
2. Click "Add to Chrome"
3. Confirm by clicking "Add extension"

### Manual Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in the top-right corner)
4. Click "Load unpacked" and select the extension directory
5. The Serene Focus icon should appear in your Chrome toolbar

## Usage

1. Click the Serene Focus icon in your Chrome toolbar
2. Click "Start" to begin your work session
3. When the timer ends, you'll be automatically redirected to a break page
4. Take your break - the extension will prevent you from browsing other pages
5. Click "Resume Work" when your break is over
6. Every 4 work sessions, you'll get a longer break

## Customization

You can customize the timer durations:

1. Click the settings (gear) icon in the popup
2. Adjust the work, short break, and long break durations
3. Click "Save" to apply your changes

## Replacing Sounds

The extension includes silent placeholder sounds. To add your own sounds:

1. Replace the files in the `sounds` directory:
   - `timer-end.mp3` - Plays when a work session ends
   - `break-end.mp3` - Plays when break time is over
2. Reload the extension in `chrome://extensions/`

## Permissions

This extension requires the following permissions:

- `tabs` - To manage and redirect tabs during break sessions
- `storage` - To save your settings and timer state
- `notifications` - To show desktop notifications
- `alarms` - To maintain the timer in the background

## Privacy

This extension does not collect any personal data. All your settings and timer data are stored locally in your browser.

## Development

### Prerequisites

- Chrome browser
- Basic knowledge of HTML, CSS, and JavaScript

### Building

1. Clone the repository
2. Make your changes
3. Test by loading the extension in Chrome

### Testing

1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the extension directory
4. Test all features to ensure they work as expected

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Inspired by various Pomodoro techniques and productivity tools
- Built with vanilla JavaScript, HTML, and CSS
- Icons created with [Feather Icons](https://feathericons.com/)

---

Happy focusing! 🚀
