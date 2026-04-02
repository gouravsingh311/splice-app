# Flowbite Skill

FlowBite UI component reference documentation for GitHub Copilot Agent Skill.

## Overview

This skill package provides comprehensive reference documentation for all Flowbite TailwindCSS HTML UI components. It allows AI agents to access detailed component examples and usage guidelines on-demand without requiring users to copy-paste documentation into chat.

## Structure

```
flowbite-skill/
├── SKILL.md              # Main skill file with component index (generated)
├── builder.py            # Script to process source docs from GitHub
├── config.yaml           # Configuration file for builder
├── _pre_SKILL.md         # Template: beginning of SKILL.md
├── _post_SKILL.md        # Template: end of SKILL.md
└── references/           # Processed documentation (generated, frontmatter stripped)
    ├── components/
    ├── customize/
    ├── forms/
    ├── getting-started/
    ├── plugins/
    └── typography/
```

## Configuration

The `config.yaml` file controls all aspects of the builder script:

### GitHub Settings
- `github.repo`: Repository to download from (e.g., "themesberg/flowbite")
- `github.branch`: Branch to use (e.g., "main")
- `github.content_path`: Path within repo (e.g., "content")
- `github.api_base`: GitHub API base URL
- `github.raw_base`: GitHub raw content base URL

### SKILL.md Templates
- `skill_templates.pre_file`: Path to pre-content template
- `skill_templates.post_file`: Path to post-content template

### Title Cleanup
- `title_cleanup`: List of regex patterns to remove from component titles
  - Each entry has `pattern`, optional `flags`, and `description`
  - Default removes "Tailwind CSS " prefix and " - Flowbite" suffix

### File Filtering
- `skip_patterns`: List of regex patterns for files to skip
  - Each entry has `pattern` and `description`
  - Default skips files starting with underscore

Example `config.yaml`:
```yaml
github:
  repo: "themesberg/flowbite"
  branch: "main"
  content_path: "content"

title_cleanup:
  - pattern: '^Tailwind\s+CSS\s+'
    flags: "IGNORECASE"
  - pattern: '\s+-\s+Flowbite$'

skip_patterns:
  - pattern: '^_.*\.md$'
```

## Building the Skill

### Prerequisites

- Python 3.x
- uv (Python package manager)

### Installation

1. Create a virtual environment with uv:
   ```bash
   uv venv
   ```

2. Install dependencies:
   ```bash
   source .venv/bin/activate  # On Linux/Mac
   uv pip install pyyaml requests
   ```

### Running the Builder

Execute the builder script to download and process documentation from GitHub:

```bash
source .venv/bin/activate
python builder.py
```

The builder will:
1. Load configuration from `config.yaml`
2. Download all markdown files from the GitHub repository
3. Extract YAML frontmatter (title, description, etc.)
4. Strip frontmatter and save content to `references/` (maintaining folder structure)
5. Generate `SKILL.md` by combining `_pre_SKILL.md` + component index + `_post_SKILL.md`

### Customizing the Build

Edit `config.yaml` to:
- Change the source repository or branch
- Add/remove title cleanup patterns
- Add patterns to skip specific files
- Change template file locations

### Output

- **references/**: Contains 79 processed markdown files organized by category
- **SKILL.md**: Main skill file with metadata and component index

## Usage

When using this skill with Claude or other AI agents:

1. The agent loads the skill metadata from SKILL.md frontmatter
2. When a relevant request is made, the agent reads SKILL.md to see available components
3. The agent can then reference specific component documentation files as needed
4. Only the required documentation is loaded into context, keeping token usage efficient

## Component Categories

- **Components** (44): Accordion, Alerts, Avatar, Badge, Banner, Bottom Navigation, Breadcrumb, Button Group, Buttons, Card, Carousel, Chat Bubble, Clipboard, Datepicker, Device Mockups, Drawer, Dropdowns, Footer, Forms, Gallery, Indicators, Jumbotron, KBD, List Group, Mega Menu, Modal, Navbar, Pagination, Popover, Progress, QR Code, Rating, Sidebar, Skeleton, Speed Dial, Spinner, Stepper, Tables, Tabs, Timeline, Toast, Tooltips, Typography, Video

- **Customize** (8): Colors, Configuration, Dark Mode, Icons, Optimization, RTL, Theming, Variables

- **Forms** (13): Checkbox, File Input, Floating Label, Input Field, Number Input, Phone Input, Radio, Range, Search Input, Select, Textarea, Timepicker, Toggle

- **Getting Started** (1): Django

- **Plugins** (4): Charts, Datatables, Datepicker, WYSIWYG

- **Typography** (9): Blockquote, Headings, HR, Images, Links, Lists, Paragraphs, Text, Text Decoration

## License

This skill package is based on Flowbite documentation. See LICENSE for details.
