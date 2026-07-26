const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// ─── Get CPU usage ──────────────────────────────────────────────────────────
const getCpuUsage = async () => {
  const loadAvg = os.loadavg();
  const cpus = os.cpus();
  const totalCores = cpus.length;
  
  return {
    loadAverage: loadAvg,
    cores: totalCores,
    usagePercent: ((loadAvg[0] / totalCores) * 100).toFixed(2) + '%'
  };
};

// ─── Get Memory usage ──────────────────────────────────────────────────────
const getMemoryUsage = () => {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  
  return {
    total: (total / 1024 / 1024).toFixed(2) + ' MB',
    free: (free / 1024 / 1024).toFixed(2) + ' MB',
    used: (used / 1024 / 1024).toFixed(2) + ' MB',
    usedPercent: ((used / total) * 100).toFixed(2) + '%',
    freePercent: ((free / total) * 100).toFixed(2) + '%'
  };
};

// ─── Get Storage usage ──────────────────────────────────────────────────────
const getStorageUsage = async () => {
  try {
    const { stdout } = await execPromise('df -h /');
    const lines = stdout.split('\n');
    const data = lines[1].split(/\s+/);
    
    return {
      filesystem: data[0],
      size: data[1],
      used: data[2],
      available: data[3],
      usePercent: data[4].replace('%', ''),
      mounted: data[5]
    };
  } catch (error) {
    console.error('Error getting storage usage:', error);
    return null;
  }
};

// ─── Get Bandwidth usage ──────────────────────────────────────────────────
const getBandwidthUsage = async () => {
  try {
    const { stdout } = await execPromise('cat /proc/net/dev');
    const lines = stdout.split('\n');
    let totalReceived = 0;
    let totalTransmitted = 0;
    
    for (const line of lines) {
      if (line.includes('eth0') || line.includes('venet0') || line.includes('ens3')) {
        const parts = line.trim().split(/\s+/);
        totalReceived = parseInt(parts[1]);
        totalTransmitted = parseInt(parts[9]);
        break;
      }
    }
    
    return {
      received: (totalReceived / 1024 / 1024).toFixed(2) + ' MB',
      transmitted: (totalTransmitted / 1024 / 1024).toFixed(2) + ' MB',
      total: ((totalReceived + totalTransmitted) / 1024 / 1024).toFixed(2) + ' MB'
    };
  } catch (error) {
    console.error('Error getting bandwidth usage:', error);
    return null;
  }
};

// ─── Get Uptime ──────────────────────────────────────────────────────────────
const getUptime = () => {
  const uptimeSeconds = os.uptime();
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  
  return {
    seconds: uptimeSeconds,
    formatted: `${days}d ${hours}h ${minutes}m`
  };
};

// ─── Get Process count ──────────────────────────────────────────────────────
const getProcessCount = async () => {
  try {
    const { stdout } = await execPromise('ps aux | wc -l');
    return parseInt(stdout.trim()) - 1;
  } catch (error) {
    console.error('Error getting process count:', error);
    return 0;
  }
};

// ─── Main monitoring function ──────────────────────────────────────────────
const getSystemStats = async () => {
  const cpu = await getCpuUsage();
  const memory = getMemoryUsage();
  const storage = await getStorageUsage();
  const bandwidth = await getBandwidthUsage();
  const uptime = getUptime();
  const processes = await getProcessCount();
  
  return {
    timestamp: new Date().toISOString(),
    cpu,
    memory,
    storage,
    bandwidth,
    uptime,
    processes
  };
};

// ─── Export functions ──────────────────────────────────────────────────────
module.exports = {
  getSystemStats,
  getCpuUsage,
  getMemoryUsage,
  getStorageUsage,
  getBandwidthUsage,
  getUptime,
  getProcessCount
};
