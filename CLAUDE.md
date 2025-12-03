# Save-To-NAS MCP

## Project Overview

This MCP server provides tools for saving files and folders to a local Synology NAS over the network. The goal is to eliminate repetitive steps when transferring data to NAS storage.

## NAS Configuration

- **NAS**: Synology NAS
- **IP Address**: 10.0.0.50
- **Protocol**: NFS
- **Shares**: Discoverable via NFS (dynamic, not hardcoded)

## Core Functionality

The MCP should:

1. **Discover NFS shares** - Query the NAS to list available NFS mounts
2. **Check local mounts** - Determine if a target share is already mounted on the local machine
3. **Mount if needed** - If not mounted, mount the NFS share temporarily or use direct network transfer
4. **Transfer data** - Copy files/folders to the specified NAS location
5. **Handle paths intelligently** - Accept relative or absolute paths, resolve destinations on NAS

## Design Principles

- **Minimal tool bloat** - One unified tool for saving to NAS, not separate tools for volume management
- **Self-discovering** - The MCP discovers available shares rather than requiring hardcoded volume definitions
- **Mount-aware** - Checks if shares are already mounted locally before attempting network operations
- **Context-embedded** - All NAS details (IP, protocol, discovery method) are built into the MCP so users don't need to specify them each time

## Usage Pattern

User says: "Save this folder to [share-name]"

MCP handles:
1. Finding the share on the NAS
2. Checking if it's mounted
3. Mounting or using network path
4. Transferring the data

## Development Notes

- Target environment: Ubuntu Linux with NFS client tools
- Local mounts typically at `/mnt/` or similar
- Use `showmount -e 10.0.0.50` to discover NFS exports
- Check `/proc/mounts` or `mount` output for existing mounts
