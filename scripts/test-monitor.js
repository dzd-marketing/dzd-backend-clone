const monitor = require('./monitor');

async function test() {
  console.log('Testing VPS Monitor...');
  const stats = await monitor.getSystemStats();
  console.log('CPU:', stats.cpu);
  console.log('Memory:', stats.memory);
  console.log('Storage:', stats.storage);
  console.log('Bandwidth:', stats.bandwidth);
  console.log('Uptime:', stats.uptime);
  console.log('Processes:', stats.processes);
}

test();
