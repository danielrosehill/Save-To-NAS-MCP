#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";

const execAsync = promisify(exec);

// NAS Configuration - configurable via environment variables
const NAS_CONFIG = {
  ip: process.env.NAS_IP || "10.0.0.50",
  protocol: "nfs",
  localMountBase: process.env.NAS_MOUNT_BASE || "/mnt/nas",
  volumePrefix: process.env.NAS_VOLUME_PREFIX || "/volume1",
};

/**
 * Discover available NFS exports from the NAS
 */
async function discoverNfsExports() {
  try {
    const { stdout } = await execAsync(`showmount -e ${NAS_CONFIG.ip}`);
    const lines = stdout.trim().split("\n").slice(1); // Skip header line

    return lines.map((line) => {
      const regex = new RegExp(`^(${NAS_CONFIG.volumePrefix}/[^\\s]+)`);
      const match = line.match(regex);
      if (match) {
        const fullPath = match[1];
        const shareName = fullPath.replace(`${NAS_CONFIG.volumePrefix}/`, "");
        return {
          exportPath: fullPath,
          shareName: shareName,
          // Normalize to how it appears locally (spaces become dashes typically)
          localName: shareName.replace(/ /g, "-"),
        };
      }
      return null;
    }).filter(Boolean);
  } catch (error) {
    throw new Error(`Failed to discover NFS exports: ${error.message}`);
  }
}

/**
 * Get currently mounted NAS shares
 */
async function getMountedShares() {
  try {
    const { stdout } = await execAsync(`mount | grep ${NAS_CONFIG.ip}`);
    const mounts = {};

    for (const line of stdout.trim().split("\n")) {
      if (!line) continue;
      // Parse: <NAS_IP>:/volume1/ShareName on /mnt/nas/LocalName type nfs ...
      const escapedIp = NAS_CONFIG.ip.replace(/\./g, "\\.");
      const regex = new RegExp(`^${escapedIp}:(${NAS_CONFIG.volumePrefix}/[^\\s]+)\\s+on\\s+([^\\s]+)`);
      const match = line.match(regex);
      if (match) {
        const exportPath = match[1];
        const localPath = match[2];
        const shareName = exportPath.replace(`${NAS_CONFIG.volumePrefix}/`, "");
        mounts[shareName] = {
          exportPath,
          localPath,
          shareName,
        };
      }
    }
    return mounts;
  } catch (error) {
    // No mounts found is not an error
    return {};
  }
}

/**
 * Find the local mount point for a share (fuzzy matching)
 */
async function findShareMount(shareName) {
  const mounts = await getMountedShares();

  // Exact match first
  if (mounts[shareName]) {
    return mounts[shareName].localPath;
  }

  // Try case-insensitive match
  const lowerName = shareName.toLowerCase();
  for (const [name, mount] of Object.entries(mounts)) {
    if (name.toLowerCase() === lowerName) {
      return mount.localPath;
    }
  }

  // Try matching with spaces vs dashes
  const normalizedName = shareName.replace(/-/g, " ");
  for (const [name, mount] of Object.entries(mounts)) {
    if (name.toLowerCase() === normalizedName.toLowerCase()) {
      return mount.localPath;
    }
  }

  // Check if it's mounted under /mnt/nas with normalized name
  const possiblePaths = [
    path.join(NAS_CONFIG.localMountBase, shareName),
    path.join(NAS_CONFIG.localMountBase, shareName.replace(/ /g, "-")),
    path.join(NAS_CONFIG.localMountBase, shareName.replace(/-/g, " ")),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

/**
 * Mount a share temporarily if not already mounted
 */
async function mountShare(shareName) {
  const exports = await discoverNfsExports();
  const share = exports.find(
    (e) =>
      e.shareName.toLowerCase() === shareName.toLowerCase() ||
      e.localName.toLowerCase() === shareName.toLowerCase()
  );

  if (!share) {
    throw new Error(`Share "${shareName}" not found on NAS. Use list_nas_shares to see available shares.`);
  }

  const mountPoint = path.join(NAS_CONFIG.localMountBase, share.localName);

  // Create mount point if it doesn't exist
  if (!fs.existsSync(mountPoint)) {
    await execAsync(`sudo mkdir -p "${mountPoint}"`);
  }

  // Mount the share
  try {
    await execAsync(
      `sudo mount -t nfs ${NAS_CONFIG.ip}:"${share.exportPath}" "${mountPoint}"`
    );
    return mountPoint;
  } catch (error) {
    throw new Error(`Failed to mount share: ${error.message}`);
  }
}

/**
 * Copy files/folders to the destination
 */
async function copyToNas(sourcePath, destPath, options = {}) {
  const resolvedSource = path.resolve(sourcePath);

  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`Source path does not exist: ${resolvedSource}`);
  }

  const stats = fs.statSync(resolvedSource);
  const flags = options.recursive !== false && stats.isDirectory() ? "-r" : "";
  const preserveFlags = options.preserveAttributes !== false ? "-p" : "";

  try {
    await execAsync(`cp ${flags} ${preserveFlags} "${resolvedSource}" "${destPath}"`);
    return {
      success: true,
      source: resolvedSource,
      destination: destPath,
      isDirectory: stats.isDirectory(),
    };
  } catch (error) {
    throw new Error(`Failed to copy: ${error.message}`);
  }
}

// Create MCP server
const server = new Server(
  {
    name: "save-to-nas",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "save_to_nas",
        description: `Save a file or folder to the Synology NAS at ${NAS_CONFIG.ip}.
Automatically discovers if the target share is mounted locally and uses the appropriate path.
If the share isn't mounted, it will attempt to mount it via NFS.`,
        inputSchema: {
          type: "object",
          properties: {
            source: {
              type: "string",
              description: "Path to the local file or folder to save (can be relative or absolute)",
            },
            share: {
              type: "string",
              description: "Name of the NAS share to save to (e.g., 'Daniel-Desktop-Overflow', 'Documents', 'AI_Art')",
            },
            destination_subfolder: {
              type: "string",
              description: "Optional subfolder within the share to save to",
            },
          },
          required: ["source", "share"],
        },
      },
      {
        name: "list_nas_shares",
        description: `List all available NFS shares on the Synology NAS at ${NAS_CONFIG.ip}.
Shows which shares are currently mounted locally and their mount points.`,
        inputSchema: {
          type: "object",
          properties: {
            filter: {
              type: "string",
              description: "Optional filter to search for shares by name (case-insensitive)",
            },
          },
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "list_nas_shares") {
    try {
      const exports = await discoverNfsExports();
      const mounts = await getMountedShares();

      let results = exports.map((share) => {
        const mounted = mounts[share.shareName];
        return {
          name: share.shareName,
          exportPath: share.exportPath,
          mounted: !!mounted,
          localPath: mounted?.localPath || null,
        };
      });

      // Apply filter if provided
      if (args?.filter) {
        const filter = args.filter.toLowerCase();
        results = results.filter((r) => r.name.toLowerCase().includes(filter));
      }

      const mountedCount = results.filter((r) => r.mounted).length;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                nas_ip: NAS_CONFIG.ip,
                total_shares: results.length,
                mounted_shares: mountedCount,
                shares: results,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }

  if (name === "save_to_nas") {
    try {
      const { source, share, destination_subfolder } = args;

      if (!source || !share) {
        throw new Error("Both 'source' and 'share' are required");
      }

      // Find or create mount point
      let mountPath = await findShareMount(share);

      if (!mountPath) {
        // Try to mount the share
        mountPath = await mountShare(share);
      }

      // Construct destination path
      let destPath = mountPath;
      if (destination_subfolder) {
        destPath = path.join(mountPath, destination_subfolder);
        // Create subfolder if it doesn't exist
        if (!fs.existsSync(destPath)) {
          fs.mkdirSync(destPath, { recursive: true });
        }
      }

      // Determine final destination (include source name in dest if copying to a directory)
      const sourceName = path.basename(source);
      const finalDest = path.join(destPath, sourceName);

      // Copy the files
      const result = await copyToNas(source, finalDest);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                message: `Successfully saved to NAS`,
                source: result.source,
                destination: result.destination,
                share: share,
                nas_ip: NAS_CONFIG.ip,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Save-to-NAS MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
