const express = require("express");
const axios = require("axios");
const os = require('os');
const fs = require('fs').promises; // 使用 fs.promises
const path = require("path");
const { promisify } = require('util');
const { exec } = require('child_process');
const execPromise = promisify(exec); // 保持 promisify 以便后续可能使用

// --- 配置区域 ---
// 从环境变量加载配置，并提供默认值
const config = {
    UPLOAD_URL: process.env.UPLOAD_URL || '',        // 节点或订阅自动上传地址
    PROJECT_URL: process.env.PROJECT_URL || '',      // 项目分配的 URL
    AUTO_ACCESS: process.env.AUTO_ACCESS === 'true', // 自动保活开关
    FILE_PATH: process.env.FILE_PATH || './tmp',     // 运行及文件保存目录
    SUB_PATH: process.env.SUB_PATH || 'sub',         // 订阅路径
    PORT: process.env.PORT || 3000,                  // HTTP 服务端口
    UUID: process.env.UUID || 'f877479a-4548-4d81-b292-e5d76cb1b8e9',
    NEZHA_SERVER: process.env.NEZHA_SERVER || '',    // 哪吒服务器
    NEZHA_PORT: process.env.NEZHA_PORT || '',        // 哪吒 v0 端口
    NEZHA_KEY: process.env.NEZHA_KEY || '',          // 哪吒密钥
    ARGO_DOMAIN: process.env.ARGO_DOMAIN || '',      // 固定隧道域名
    ARGO_AUTH: process.env.ARGO_AUTH || '',          // 固定隧道密钥
    ARGO_PORT: process.env.ARGO_PORT || 8001,        // 隧道端口
    CFIP: process.env.CFIP || 'www.visa.com.sg',     // 优选 IP 或域名
    CFPORT: process.env.CFPORT || 443,               // 优选端口
    NAME: process.env.NAME || 'Vls'                  // 节点名称
};

// --- 路径定义 ---
const paths = {
    npm: path.join(config.FILE_PATH, 'npm'),
    php: path.join(config.FILE_PATH, 'php'),
    web: path.join(config.FILE_PATH, 'web'),
    bot: path.join(config.FILE_PATH, 'bot'),
    sub: path.join(config.FILE_PATH, 'sub.txt'),
    bootLog: path.join(config.FILE_PATH, 'boot.log'),
    config: path.join(config.FILE_PATH, 'config.json'),
    tunnelYml: path.join(config.FILE_PATH, 'tunnel.yml'),
    tunnelJson: path.join(config.FILE_PATH, 'tunnel.json'),
    nezhaConfig: path.join(config.FILE_PATH, 'config.yaml'),
};

const app = express();

// --- 辅助函数 ---

/**
 * 延迟执行
 * @param {number} ms - 延迟的毫秒数
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 安全地执行一个后台命令
 * @param {string} command - 要执行的命令
 * @param {string} processName - 进程名称（用于日志）
 */
async function runInBackground(command, processName) {
    try {
        await execPromise(command);
        console.log(`${processName} is running.`);
    } catch (error) {
        console.error(`Error starting ${processName}: ${error.message}`);
    }
}

/**
 * 下载文件
 * @param {string} fileName - 保存的文件名
 * @param {string} fileUrl - 文件下载地址
 */
async function downloadFile(fileName, fileUrl) {
    const filePath = path.join(config.FILE_PATH, fileName);
    const writer = require('fs').createWriteStream(filePath);

    try {
        const response = await axios({
            method: 'get',
            url: fileUrl,
            responseType: 'stream',
        });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log(`Downloaded ${fileName} successfully.`);
                resolve();
            });
            writer.on('error', (err) => {
                console.error(`Failed to write ${fileName}: ${err.message}`);
                reject(err);
            });
        });
    } catch (error) {
        console.error(`Download ${fileName} failed: ${error.message}`);
        throw error; // 抛出错误，让调用者处理
    }
}

/**
 * 为文件授权
 * @param {string[]} fileList - 需要授权的文件名列表
 */
async function authorizeFiles(fileList) {
    const newPermissions = 0o775;
    for (const file of fileList) {
        const filePath = path.join(config.FILE_PATH, file);
        try {
            await fs.access(filePath); // 检查文件是否存在
            await fs.chmod(filePath, newPermissions);
            console.log(`Permissions set to ${newPermissions.toString(8)} for ${filePath}`);
        } catch (err) {
            // 如果文件不存在或授权失败，打印错误
            console.error(`Failed to set permissions for ${filePath}: ${err.message}`);
        }
    }
}

// --- 核心逻辑函数 ---

/**
 * 初始化，创建工作目录
 */
async function initialize() {
    try {
        await fs.mkdir(config.FILE_PATH, { recursive: true });
        console.log(`${config.FILE_PATH} is ready.`);
    } catch (error) {
        console.error(`Failed to create directory ${config.FILE_PATH}:`, error);
        process.exit(1); // 如果目录创建失败，则无法继续
    }
}

/**
 * 生成 Xray 配置文件
 */
async function generateXrayConfig() {
    const xrayConfig = {
        log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' },
        inbounds: [
            { port: config.ARGO_PORT, protocol: 'vless', settings: { clients: [{ id: config.UUID, flow: 'xtls-rprx-vision' }], decryption: 'none', fallbacks: [{ dest: 3001 }, { path: "/vless-argo", dest: 3002 }, { path: "/vmess-argo", dest: 3003 }, { path: "/trojan-argo", dest: 3004 }] }, streamSettings: { network: 'tcp' } },
            { port: 3001, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: config.UUID }], decryption: "none" }, streamSettings: { network: "tcp", security: "none" } },
            { port: 3002, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: config.UUID, level: 0 }], decryption: "none" }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
            { port: 3003, listen: "127.0.0.1", protocol: "vmess", settings: { clients: [{ id: config.UUID, alterId: 0 }] }, streamSettings: { network: "ws", wsSettings: { path: "/vmess-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
            { port: 3004, listen: "127.0.0.1", protocol: "trojan", settings: { clients: [{ password: config.UUID }] }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/trojan-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
        ],
        dns: { servers: ["https+local://8.8.8.8/dns-query"] },
        outbounds: [{ protocol: "freedom", tag: "direct" }, { protocol: "blackhole", tag: "block" }]
    };
    await fs.writeFile(paths.config, JSON.stringify(xrayConfig, null, 2));
    console.log('Xray config generated.');
}

/**
 * 根据系统架构下载所需依赖
 */
async function downloadDependencies() {
    const arch = os.arch();
    const isArm = ['arm', 'arm64', 'aarch64'].includes(arch);
    const archPath = isArm ? 'arm64' : 'amd64';

    const filesToDownload = [
        { fileName: "web", fileUrl: `https://${archPath}.ssss.nyc.mn/web` },
        { fileName: "bot", fileUrl: `https://${archPath}.ssss.nyc.mn/2go` }
    ];

    if (config.NEZHA_SERVER && config.NEZHA_KEY) {
        if (config.NEZHA_PORT) {
            files
