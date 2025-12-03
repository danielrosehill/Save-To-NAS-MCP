# Save-To-NAS MCP

An MCP server for saving files and folders to a local Synology NAS over NFS. Eliminates repetitive steps when transferring data to NAS storage.

## Configuration

The NAS details are embedded in the server:

- **IP**: 10.0.0.50
- **Protocol**: NFS
- **Local Mount Base**: /mnt/nas

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

## Installation

### For Claude Code

Add to your MCP configuration (`~/.claude/settings.json` or project settings):

```json
{
  "mcpServers": {
    "save-to-nas": {
      "command": "node",
      "args": ["/home/daniel/repos/github/Save-To-NAS-MCP/src/index.js"]
    }
  }
}
```

### Dependencies

```bash
cd /home/daniel/repos/github/Save-To-NAS-MCP
npm install
```

## How It Works

1. **Discovery**: Queries the NAS via `showmount -e` to find available NFS exports
2. **Mount Detection**: Checks if the target share is already mounted locally
3. **Smart Mounting**: If not mounted, attempts to mount via NFS (requires sudo)
4. **Transfer**: Copies files/folders to the destination, preserving attributes

## Requirements

- NFS client tools (`nfs-common` on Ubuntu)
- Network access to the NAS
- Sudo privileges for mounting unmounted shares
