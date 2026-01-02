# Save-To-NAS MCP

An MCP server for saving files and folders to a local NAS over NFS. Eliminates repetitive steps when transferring data to NAS storage.

## Installation

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
| `PORT` | HTTP server port | `3847` |

## Adding to Claude Code / Claude Desktop

This MCP server uses Streamable HTTP transport. Add to your MCP settings:

```json
{
  "mcpServers": {
    "save-to-nas": {
      "type": "http",
      "url": "http://localhost:3847/mcp"
    }
  }
}
```

To run the server:

```bash
# If installed globally
NAS_IP=192.168.1.100 save-to-nas-mcp

# Or via npx
NAS_IP=192.168.1.100 npx save-to-nas-mcp

# Or from source
NAS_IP=192.168.1.100 npm start
```

## Tools

### `nas`

Unified tool for interacting with your Synology NAS. Supports listing available shares and saving files/folders.

**Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `action` | Yes | `"list"` to show shares, `"save"` to copy files |
| `source` | For save | Path to local file or folder to save |
| `share` | For save | Name of the NAS share (e.g., "Documents", "AI_Art") |
| `destination_subfolder` | No | Subfolder within the share to save to |
| `filter` | No | Filter shares by name (for list action) |

**Examples:**

```
List all available NAS shares
→ action: "list"

Save a folder to the Documents share
→ action: "save", source: "/home/user/projects/my-data", share: "Documents"

Save to a subfolder
→ action: "save", source: "./report.pdf", share: "Documents", destination_subfolder: "reports/2024"
```

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
