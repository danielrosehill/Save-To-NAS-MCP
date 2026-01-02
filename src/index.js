#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "http";
import { randomUUID } from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";

const execAsync = promisify(exec);

// NAS Configuration - configurable via environment variables
const NAS_CONFIG = {
  ip: process.env.NAS_IP || "10.0.0.50",
  protocol: "nfs",
  localMountBase: process.env.NAS_MOUNT_BASE || "/mnt/nas",
  volumePrefix: process.env.NAS_VOLUME_PREFIX || "/volume1",
};

const PORT = parseInt(process.env.PORT || "3847", 10);

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
    return {};
  }
}

/**
 * Find the local mount point for a share (fuzzy matching)
 */
async function findShareMount(shareName) {
  const mounts = await getMountedShares();

  if (mounts[shareName]) {
    return mounts[shareName].localPath;
  }

  const lowerName = shareName.toLowerCase();
  for (const [name, mount] of Object.entries(mounts)) {
    if (name.toLowerCase() === lowerName) {
      return mount.localPath;
    }
  }

  const normalizedName = shareName.replace(/-/g, " ");
  for (const [name, mount] of Object.entries(mounts)) {
    if (name.toLowerCase() === normalizedName.toLowerCase()) {
      return mount.localPath;
    }
  }

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
    throw new Error(`Share "${shareName}" not found on NAS. Use action "list" to see available shares.`);
  }

  const mountPoint = path.join(NAS_CONFIG.localMountBase, share.localName);

  if (!fs.existsSync(mountPoint)) {
    await execAsync(`sudo mkdir -p "${mountPoint}"`);
  }

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

/**
 * Handle the list action
 */
async function handleList(filter) {
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

  if (filter) {
    const filterLower = filter.toLowerCase();
    results = results.filter((r) => r.name.toLowerCase().includes(filterLower));
  }

  const mountedCount = results.filter((r) => r.mounted).length;

  return {
    nas_ip: NAS_CONFIG.ip,
    total_shares: results.length,
    mounted_shares: mountedCount,
    shares: results,
  };
}

/**
 * Handle the save action
 */
async function handleSave(source, share, destinationSubfolder) {
  if (!source || !share) {
    throw new Error("Both 'source' and 'share' are required for save action");
  }

  let mountPath = await findShareMount(share);

  if (!mountPath) {
    mountPath = await mountShare(share);
  }

  let destPath = mountPath;
  if (destinationSubfolder) {
    destPath = path.join(mountPath, destinationSubfolder);
    if (!fs.existsSync(destPath)) {
      fs.mkdirSync(destPath, { recursive: true });
    }
  }

  const sourceName = path.basename(source);
  const finalDest = path.join(destPath, sourceName);

  const result = await copyToNas(source, finalDest);

  return {
    success: true,
    message: "Successfully saved to NAS",
    source: result.source,
    destination: result.destination,
    share: share,
    nas_ip: NAS_CONFIG.ip,
  };
}

// Create MCP server
const server = new McpServer(
  {
    name: "save-to-nas",
    version: "2.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register consolidated tool
server.tool(
  "nas",
  `Interact with the Synology NAS at ${NAS_CONFIG.ip}. Supports listing available shares and saving files/folders.`,
  {
    action: z.enum(["list", "save"]).describe("Action to perform: 'list' shows available shares, 'save' copies files to NAS"),
    source: z.string().optional().describe("Path to local file/folder to save (required for 'save' action)"),
    share: z.string().optional().describe("Name of the NAS share (required for 'save' action, e.g., 'Documents', 'AI_Art')"),
    destination_subfolder: z.string().optional().describe("Optional subfolder within the share to save to"),
    filter: z.string().optional().describe("Optional filter for 'list' action to search shares by name"),
  },
  async ({ action, source, share, destination_subfolder, filter }) => {
    try {
      if (action === "list") {
        const result = await handleList(filter);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      if (action === "save") {
        const result = await handleSave(source, share, destination_subfolder);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      return {
        content: [{ type: "text", text: `Unknown action: ${action}` }],
        isError: true,
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }
);

// Start the Streamable HTTP server
async function main() {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  await server.connect(transport);

  const httpServer = createServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id",
      });
      res.end();
      return;
    }

    // Add CORS headers to all responses
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id");

    // Only handle /mcp endpoint
    if (req.url !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found. Use /mcp endpoint." }));
      return;
    }

    await transport.handleRequest(req, res);
  });

  httpServer.listen(PORT, () => {
    console.error(`Save-to-NAS MCP server running on http://localhost:${PORT}/mcp`);
    console.error(`NAS IP: ${NAS_CONFIG.ip}`);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
