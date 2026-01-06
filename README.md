# @zincapp/archon-cli

Command-line interface for [ARCHON](https://github.com/vidaldiego/archon) infrastructure management platform.

## Installation

```bash
npm install -g @zincapp/archon-cli
```

## Quick Start

```bash
# Configure your ARCHON server
archon profile create production -u https://archon.example.com --use

# Login
archon auth login admin

# View dashboard
archon dashboard

# List machines
archon machines list

# List services
archon services list
```

## Features

- **Multi-profile support** - Manage multiple ARCHON servers
- **JWT token management** - Automatic token refresh
- **Service management** - View services, cluster status, pre-update checks
- **Rolling updates** - Start and monitor update jobs
- **Ad-hoc execution** - Run commands across machines with sudo support
- **Knowledge base** - Manage documentation and runbooks

## Commands

### Profile Management

```bash
archon profile list                    # List profiles
archon profile create <name> -u <url>  # Create profile
archon profile use <name>              # Switch profile
```

### Authentication

```bash
archon auth login <username>           # Login (prompts for password)
archon auth status                     # Check auth status
archon auth logout                     # Logout
```

### Machines

```bash
archon machines list                   # List all machines
archon machines get <id>               # Machine details
archon machines health-check           # Trigger health checks
archon machines tags get <id>          # Get machine tags
```

### Services

```bash
archon services list                   # List services
archon services get <id>               # Service details
archon services cluster-status <id>    # Cluster health
archon services pre-check <id>         # Pre-update validation
archon services action <id> <action>   # Plugin action
```

### Updates

```bash
archon updates list                    # List update jobs
archon updates get <id>                # Job details
archon updates start <serviceId>       # Start rolling update
```

### Ad-hoc Execution

```bash
# Run command on machines by tag
archon exec run "df -h" -t env=prod

# Run with sudo
archon exec run "apt upgrade -y" -t role=webserver --become

# Preview targets
archon exec preview -t env=prod

# View execution history
archon exec history
```

### Raw API Access

```bash
archon raw GET /api/health
archon raw POST /api/machines/health-check
```

## Global Options

```bash
-p, --profile <name>   # Use specific profile
--json                 # Output as JSON
--table                # Output as table (default)
--text                 # Output as plain text
-q, --quiet            # Minimal output
```

## Configuration

Configuration is stored in `~/.archon/`:

```
~/.archon/
├── config.json        # Profiles configuration
└── tokens/
    └── <profile>.json # JWT tokens per profile
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ARCHON_PROFILE` | Override active profile |
| `ARCHON_URL` | Override server URL |
| `ARCHON_USER` | Username for auth |
| `ARCHON_PASS` | Password for auth |

## License

MIT
