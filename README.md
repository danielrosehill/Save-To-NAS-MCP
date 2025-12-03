# Save-To-NAS MCP

An MCP server for saving files and folders to a local NAS over NFS. Eliminates repetitive steps when transferring data to NAS storage.

## Installation

### Via mcpm (recommended)

```bash
mcpm install save-to-nas-mcp
mcpm edit save-to-nas --env "NAS_IP=192.168.1.100"
mcpm add save-to-nas --profile your-profile  # Add to a profile
```

### Via npm

```bash
npm install -g save-to-nas-mcp
```

### From source

```bash
git clone https://github.com/danielrosehill/Save-To-NAS-MCP.git
cd Save-To-NAS-MCP
npm install
```

## Configuration

Configure the MCP server with environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `NAS_IP` | IP address of your NAS | `10.0.0.50` |
| `NAS_MOUNT_BASE` | Local directory for NFS mounts | `/mnt/nas` |
| `NAS_VOLUME_PREFIX` | NAS volume path prefix | `/volume1` |

### Claude Code / Claude Desktop

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "save-to-nas": {
      "command": "npx",
      "args": ["-y", "save-to-nas-mcp"],
      "env": {
        "NAS_IP": "192.168.1.100"
      }
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "save-to-nas": {
      "command": "save-to-nas-mcp",
      "env": {
        "NAS_IP": "192.168.1.100"
      }
    }
  }
}
```

## Tools

### `save_to_nas`

Save a file or folder to a NAS share.

**Parameters:**
- `source` (required): Path to the local file or folder
- `share` (required): Name of the NAS share (e.g., "AI_Art", "Documents")
- `destination_subfolder` (optional): Subfolder within the share

**Example:**
```
Save ~/projects/my-data to the Documents share
```

### `list_nas_shares`

List available NFS shares on the NAS and show which are mounted.

**Parameters:**
- `filter` (optional): Filter shares by name

## How It Works

1. **Discovery**: Queries the NAS via `showmount -e` to find available NFS exports
2. **Mount Detection**: Checks if the target share is already mounted locally
3. **Smart Mounting**: If not mounted, attempts to mount via NFS (requires sudo)
4. **Transfer**: Copies files/folders to the destination, preserving attributes

## Requirements

- Linux with NFS client tools (`nfs-common` on Ubuntu/Debian)
- Network access to the NAS
- NFS exports configured on your NAS
- Sudo privileges for mounting unmounted shares

## License

MIT
