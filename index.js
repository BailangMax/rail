import express from 'express';
import axios from 'axios';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';

// --- 全局配置 ---
// 从环境变量加载配置，并提供默认值
const config = {
    UPLOAD_URL: process.env.UPLOAD_URL || '',
    PROJECT_URL: process.env.PROJECT_URL || '',
    AUTO_ACCESS: process.env.AUTO_ACCESS === 'true',
    FILE_PATH: '/tmp', // 在 Serverless 环境中，只有 /tmp 目录是可写的
    SUB_PATH: process.env.SUB_PATH || 'sub',
    PORT: process.env.SERVER_PORT || process.env.PORT || 3000,
    UUID: process.env.UUID || '70c6b924-9327-477e-b504-36661c6fb65e',
    NEZHA_SERVER: process.env.NEZHA_SERVER || 'a.holoy.dpdns.org:36958',
    NEZHA_PORT: process.env.NEZHA_PORT || '',
    NEZHA_KEY: process.env.NEZHA_KEY || 'NwxKJwM9UKRCX5TBPaBm0IrjNCSyflif',
    ARGO_DOMAIN: process.env.ARGO_DOMAIN || '',
    ARGO_AUTH: process.env.ARGO_AUTH || '',
    ARGO_PORT: process.env.ARGO_PORT || 8001,
    CFIP: process.env.CFIP || 'www.visa.com.sg',
    CFPORT: process.env.CFPORT || 443,
    NAME: process.env.NAME || 'Vls',
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

// --- 全局状态变量 ---
// 用于防止在每次请求时都重复初始化
let isInitialized = false;
// 用于存储生成的订阅内容
let subContentBase64 = '';

// --- 辅助函数 ---

/**
 * 安全地执行一个命令 (不需要等待其完成)
 * @param {string} command - 要执行的命令
 * @param {string} processName - 进程名称（用于日志）
 */
function runCommand(command, processName) {
    console.log(`Starting ${processName} with command: ${command}`);
    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error starting ${processName}: ${error.message}`);
            return;
        }
        if (stderr) {
            console.error(`${processName} stderr: ${stderr}`);
            return;
        }
        console.log(`${processName} stdout: ${stdout}`);
    });
}

/**
 * 延迟执行
 * @param {number} ms - 延迟的毫秒数
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 下载文件
 * @param {string} fileName - 保存的文件名
 * @param {string} fileUrl - 文件下载地址
 */
async function downloadFile(fileName, fileUrl) {
    const filePath = path.join(config.FILE_PATH, fileName);
    try {
        const response = await axios({
            method: 'get',
            url: fileUrl,
            responseType: 'arraybuffer',
        });
        await fs.writeFile(filePath, response.data);
        console.log(`Downloaded ${fileName} successfully.`);
    } catch (error) {
        console.error(`Download ${fileName} failed: ${error.message}`);
        throw error; // 抛出错误以中断Promise.all
    }
}

/**
 * 为文件授权
 * @param {string[]} fileList - 需要授权的文件名列表
 */
async function authorizeFiles(fileList) {
    for (const file of fileList) {
        const filePath = path.join(config.FILE_PATH, file);
        try {
            await fs.access(filePath);
            await fs.chmod(filePath, 0o775);
            console.log(`Permissions set for ${filePath}`);
        } catch (err) {
            console.error(`Failed to set permissions for ${filePath}: ${err.message}`);
        }
    }
}

// --- 核心逻辑 ---

/**
 * 初始化，创建工作目录
 */
async function initialize() {
    try {
        await fs.mkdir(config.FILE_PATH, { recursive: true });
        console.log(`${config.FILE_PATH} is ready.`);
    } catch (error) {
        console.error(`Failed to create directory ${config.FILE_PATH}:`, error);
        throw error;
    }
}

/**
 * 根据系统架构选择要下载的文件
 */
function getFilesForArchitecture() {
    const arch = os.arch();
    const isArm = ['arm', 'arm64', 'aarch64'].includes(arch);
    const archPath = isArm ? 'arm64' : 'amd64';
    
    let files = [
        { fileName: "web", fileUrl: `https://${archPath}.ssss.nyc.mn/web` },
        { fileName: "bot", fileUrl: `https://${archPath}.ssss.nyc.mn/2go` }
    ];

    if (config.NEZHA_SERVER && config.NEZHA_KEY) {
        if (config.NEZHA_PORT) { // v0
            files.push({ fileName: "npm", fileUrl: `https://${archPath}.ssss.nyc.mn/agent` });
        } else { // v1
            files.push({ fileName: "php", fileUrl: `https://${archPath}.ssss.nyc.mn/v1` });
        }
    }
    return files;
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
 * 启动所有后台服务
 */
async function runServices() {
    // 授权
    const filesToAuthorize = ['web', 'bot'];
    if (config.NEZHA_SERVER && config.NEZHA_KEY) {
        filesToAuthorize.push(config.NEZHA_PORT ? 'npm' : 'php');
    }
    await authorizeFiles(filesToAuthorize);
    
    // 运行 Xray
    runCommand(`${paths.web} -c ${paths.config}`, 'Xray (web)');
    await delay(1000);

    // 运行哪吒探针
    if (config.NEZHA_SERVER && config.NEZHA_KEY) {
        if (config.NEZHA_PORT) { // v0
            const nezhaTls = ['443', '8443', '2096', '2087', '2083', '2053'].includes(config.NEZHA_PORT) ? '--tls' : '';
            runCommand(`${paths.npm} -s ${config.NEZHA_SERVER}:${config.NEZHA_PORT} -p ${config.NEZHA_KEY} ${nezhaTls}`, 'Nezha Agent (v0)');
        } else { // v1
            const port = config.NEZHA_SERVER.split(':').pop() || '';
            const nezhaTls = ['443', '8443', '2096', '2087', '2083', '2053'].includes(port);
            const configYaml = `
client_secret: ${config.NEZHA_KEY}
debug: false
server: ${config.NEZHA_SERVER}
tls: ${nezhaTls}
uuid: ${config.UUID}`;
            await fs.writeFile(paths.nezhaConfig, configYaml.trim());
            runCommand(`${paths.php} -c "${paths.nezhaConfig}"`, 'Nezha Agent (v1)');
        }
        await delay(1000);
    }
    
    // 运行 Cloudflare Tunnel
    let argoArgs;
    if (config.ARGO_AUTH && config.ARGO_DOMAIN) {
        if (config.ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) { // Token
             argoArgs = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${config.ARGO_AUTH}`;
        } else if (config.ARGO_AUTH.includes('TunnelSecret')) { // JSON
            await fs.writeFile(paths.tunnelJson, config.ARGO_AUTH);
            const tunnelId = JSON.parse(config.ARGO_AUTH).TunnelID;
            const tunnelYml = `
tunnel: ${tunnelId}
credentials-file: ${paths.tunnelJson}
ingress:
  - hostname: ${config.ARGO_DOMAIN}
    service: http://localhost:${config.ARGO_PORT}
  - service: http_status:404`;
            await fs.writeFile(paths.tunnelYml, tunnelYml.trim());
            argoArgs = `tunnel --edge-ip-version auto --config ${paths.tunnelYml} run`;
        }
    } 
    
    if (!argoArgs) { // 临时隧道
        argoArgs = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${paths.bootLog} --loglevel info --url http://localhost:${config.ARGO_PORT}`;
    }
    runCommand(`${paths.bot} ${argoArgs}`, 'Cloudflare Tunnel (bot)');
    await delay(5000); // 等待隧道启动
}

/**
 * 提取隧道域名并生成订阅
 */
async function generateSubscription() {
    let argoDomain = config.ARGO_DOMAIN;

    if (!argoDomain) { // 如果是临时隧道，从日志中读取域名
        try {
            const logContent = await fs.readFile(paths.bootLog, 'utf-8');
            const domainMatch = logContent.match(/https?:\/\/([^ ]*trycloudflare\.com)/);
            if (domainMatch && domainMatch[1]) {
                argoDomain = domainMatch[1];
                console.log(`Found temporary Argo domain: ${argoDomain}`);
            } else {
                 console.error("Could not find temporary Argo domain in boot log.");
                 return;
            }
        } catch (error) {
            console.error("Could not read boot.log to get temporary domain:", error.message);
            return;
        }
    }
    
    const ISP = "Cloud"; // 在 Serverless 环境无法准确获取 ISP
    const vmessConfig = { v: '2', ps: `${config.NAME}-${ISP}`, add: config.CFIP, port: config.CFPORT, id: config.UUID, aid: '0', scy: 'none', net: 'ws', type: 'none', host: argoDomain, path: '/vmess-argo?ed=2560', tls: 'tls', sni: argoDomain, alpn: '' };
    
    const subLinks = [
        `vless://${config.UUID}@${config.CFIP}:${config.CFPORT}?encryption=none&security=tls&sni=${argoDomain}&type=ws&host=${argoDomain}&path=%2Fvless-argo%3Fed%3D2560#${config.NAME}-${ISP}`,
        `vmess://${Buffer.from(JSON.stringify(vmessConfig)).toString('base64')}`,
        `trojan://${config.UUID}@${config.CFIP}:${config.CFPORT}?security=tls&sni=${argoDomain}&type=ws&host=${argoDomain}&path=%2Ftrojan-argo%3Fed%3D2560#${config.NAME}-${ISP}`
    ].join('\n\n');
    
    subContentBase64 = Buffer.from(subLinks).toString('base64');
    await fs.writeFile(paths.sub, subContentBase64);
    console.log("Subscription content generated and saved.");
    await uploadSubscription();
}

/**
 * 上传订阅（如果配置了）
 */
async function uploadSubscription() {
    if (config.UPLOAD_URL && config.PROJECT_URL) {
        try {
            await axios.post(`${config.UPLOAD_URL}/api/add-subscriptions`, 
                { subscription: [`${config.PROJECT_URL}/${config.SUB_PATH}`] },
                { headers: { 'Content-Type': 'application/json' } }
            );
            console.log("Subscription uploaded to merge service.");
        } catch (error) {
            console.error("Failed to upload subscription:", error.response?.data || error.message);
        }
    }
}


/**
 * 主初始化函数
 */
async function mainInitialization() {
    try {
        await initialize();
        await generateXrayConfig();
        const filesToDownload = getFilesForArchitecture();
        await Promise.all(
            filesToDownload.map(file => downloadFile(file.fileName, file.fileUrl))
        );
        await runServices();
        await generateSubscription();
        isInitialized = true;
        console.log("Initialization completed successfully.");
    } catch (error) {
        console.error("An error occurred during initialization:", error);
        // 如果初始化失败，重置标志以便下次重试
        isInitialized = false;
    }
}


// --- Serverless 入口点 ---
export default async ({ req, res, log, error }) => {
    // 确保初始化代码只在第一次请求时运行
    if (!isInitialized) {
        await mainInitialization();
    }
    
    // 路由处理
    if (req.path === `/${config.SUB_PATH}`) {
        if (subContentBase64) {
            return res.send(subContentBase64, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
        } else {
            return res.send("Subscription is being generated, please try again in a moment.", 503);
        }
    }
    
    return res.send("Background services are running. Access your subscription at /" + config.SUB_PATH);
};
