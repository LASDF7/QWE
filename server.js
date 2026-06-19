const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { Client, GatewayIntentBits, Collection, EmbedBuilder } = require('discord.js');
const { Manager } = require('erela.js');
const Spotify = require('erela.js-spotify');

const app = express();
const server = http.createServer(app);
app.use(express.json());
app.use(express.static('public'));

let bot = null, botStatus = 'offline', logs = [], botToken = '';

function addLog(msg) {
  const time = new Date().toLocaleTimeString('ar-SA');
  const log = `[${time}] ${msg}`;
  logs.push(log);
  if (logs.length > 100) logs.shift();
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify({ type: 'log', message: log })); });
}

const wss = new WebSocket.Server({ server });
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'status', status: botStatus }));
  logs.forEach(l => ws.send(JSON.stringify({ type: 'log', message: l })));
});

let manager = null;

function setupMusic() {
  // Lavalink node (مجاني من frelavalink)
  manager = new Manager({
    nodes: [
      {
        host: 'lavalink-v4.teramont.net',
        port: 443,
        password: 'eHKuFcz67k4lBS64',
        secure: true
      }
    ],
    plugins: [
      new Spotify({
        clientID: 'YOUR_SPOTIFY_CLIENT_ID',     // ← حط هنا
        clientSecret: 'YOUR_SPOTIFY_CLIENT_SECRET' // ← حط هنا
      })
    ],
    send(id, payload) {
      const guild = bot.guilds.cache.get(id);
      if (guild) guild.shard.send(payload);
    }
  });

  manager.on('nodeConnect', (node) => addLog(`🎵 Lavalink connected: ${node.options.identifier}`));
  manager.on('nodeError', (node, error) => addLog(`❌ Lavalink error: ${error.message}`));
  manager.on('trackStart', (player, track) => {
    const channel = bot.channels.cache.get(player.textChannel);
    if (channel) {
      channel.send({ embeds: [{ color: 0x808080, title: '▶️ الأغنية الحالية', description: `**${track.title}**\nالفنان: ${track.author}\nالمدة: ${formatTime(track.duration)}` }] });
    }
  });
  manager.on('queueEnd', (player) => {
    addLog('⏹️ Queue ended');
    player.destroy();
  });
}

function formatTime(ms) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function setupCommands() {
  bot.commands = new Collection();

  bot.commands.set('play', {
    name: 'play', aliases: ['شغل', 'p'],
    async execute(message, args) {
      const query = args.join(' ');
      if (!query) return message.reply('❌ اكتب اسم الأغنية أو الرابط!');

      const voiceChannel = message.member.voice.channel;
      if (!voiceChannel) return message.reply('❌ ادخل روم صوتي!');

      const player = manager.create({
        guild: message.guild.id,
        voiceChannel: voiceChannel.id,
        textChannel: message.channel.id
      });

      if (player.state !== 'CONNECTED') player.connect();

      const search = await manager.search(query, message.author);
      if (search.loadType === 'LOAD_FAILED') return message.reply('❌ صار خطأ!');
      if (search.loadType === 'NO_MATCHES') return message.reply('❌ ما لقيت شي! جرب اسم ثاني.');

      const track = search.tracks[0];
      player.queue.add(track);

      const embed = new EmbedBuilder()
        .setColor(0x808080)
        .setTitle('🎵 أضيفت للقائمة')
        .setDescription(`**${track.title}**`)
        .addFields(
          { name: 'الفنان', value: track.author, inline: true },
          { name: 'المدة', value: formatTime(track.duration), inline: true },
          { name: 'المصدر', value: search.loadType === 'PLAYLIST_LOADED' ? 'Playlist' : track.sourceName || 'Unknown', inline: true }
        )
        .setThumbnail(track.displayThumbnail?.() || message.author.displayAvatarURL());

      message.reply({ embeds: [embed] });

      if (!player.playing && !player.paused && player.queue.size === 1) player.play();
    }
  });

  bot.commands.set('skip', { name: 'skip', aliases: ['تخطي', 's'], execute(message) {
    const player = manager.get(message.guild.id);
    if (!player) return message.reply('❌ ما في شي شغال!');
    player.stop();
    message.reply('⏭️ تخطيت!');
  }});

  bot.commands.set('stop', { name: 'stop', aliases: ['وقف', 'st'], execute(message) {
    const player = manager.get(message.guild.id);
    if (!player) return message.reply('❌ ما في شي شغال!');
    player.destroy();
    message.reply('⏹️ وقفت ومسحت!');
  }});

  bot.commands.set('queue', { name: 'queue', aliases: ['قائمة', 'q'], execute(message) {
    const player = manager.get(message.guild.id);
    if (!player || !player.queue.size) return message.reply('❌ القائمة فاضية!');
    const list = player.queue.map((t, i) => `${i + 1}. **${t.title}** - ${t.author}`).join('\n');
    message.reply({ embeds: [{ color: 0x808080, title: '🎵 القائمة', description: list, footer: { text: `${player.queue.size} أغنية | Loop: ${player.queueRepeat ? '✅' : '❌'}` } }] });
  }});

  bot.commands.set('loop', { name: 'loop', aliases: ['تكرار', 'l'], execute(message) {
    const player = manager.get(message.guild.id);
    if (!player) return message.reply('❌ ما في شي شغال!');
    player.setQueueRepeat(!player.queueRepeat);
    message.reply(`🔁 التكرار: ${player.queueRepeat ? '**شغال**' : '**طافي**'}`);
  }});

  bot.commands.set('np', { name: 'np', aliases: ['الحين', 'now'], execute(message) {
    const player = manager.get(message.guild.id);
    if (!player || !player.queue.current) return message.reply('❌ ما في شي شغال!');
    const track = player.queue.current;
    message.reply({ embeds: [{ color: 0x808080, title: '▶️ الحين', description: `**${track.title}**\nالفنان: ${track.author}\nالمدة: ${formatTime(track.duration)}` }] });
  }});

  bot.commands.set('pause', { name: 'pause', aliases: ['وقف مؤقت', 'ps'], execute(message) {
    const player = manager.get(message.guild.id);
    if (!player) return message.reply('❌ ما في شي!');
    player.pause(true);
    message.reply('⏸️ وقفت!');
  }});

  bot.commands.set('resume', { name: 'resume', aliases: ['كمل', 'rs'], execute(message) {
    const player = manager.get(message.guild.id);
    if (!player) return message.reply('❌ ما في شي!');
    player.pause(false);
    message.reply('▶️ كملت!');
  }});

  bot.commands.set('leave', { name: 'leave', aliases: ['طل', 'اخرج', 'dc'], execute(message) {
    const player = manager.get(message.guild.id);
    if (player) player.destroy();
    message.reply('👋 طلعت!');
  }});

  bot.commands.set('volume', { name: 'volume', aliases: ['صوت', 'vol'], execute(message, args) {
    const player = manager.get(message.guild.id);
    if (!player) return message.reply('❌ ما في شي!');
    const vol = parseInt(args[0]);
    if (!vol || vol < 1 || vol > 100) return message.reply('❌ رقم من 1-100!');
    player.setVolume(vol);
    message.reply(`🔊 الصوت: **${vol}%**`);
  }});

  bot.commands.set('help', { name: 'help', aliases: ['مساعدة', 'h'], execute(message) {
    message.reply({ embeds: [{ color: 0x808080, title: '🎵 أوامر الموسيقى', description: '`!play [اسم/رابط]` - يشغل (Spotify, SoundCloud, YouTube, Apple Music)\n`!skip` - تخطي\n`!stop` - إيقاف\n`!queue` - القائمة\n`!loop` - تكرار\n`!np` - الحين\n`!pause` - توقف مؤقت\n`!resume` - كمل\n`!volume [1-100]` - الصوت\n`!leave` - خروج' }] });
  }});
}

function setupEvents() {
  bot.on('messageCreate', (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith('!')) return;
    const args = message.content.slice(1).trim().split(/ +/);
    let cmd = args.shift().toLowerCase();
    const aliases = { 'شغل': 'play', 'p': 'play', 'تخطي': 'skip', 's': 'skip', 'وقف': 'stop', 'st': 'stop', 'قائمة': 'queue', 'q': 'queue', 'تكرار': 'loop', 'l': 'loop', 'الحين': 'np', 'now': 'np', 'وقف مؤقت': 'pause', 'ps': 'pause', 'كمل': 'resume', 'rs': 'resume', 'طل': 'leave', 'اخرج': 'leave', 'dc': 'leave', 'صوت': 'volume', 'vol': 'volume', 'مساعدة': 'help', 'h': 'help' };
    if (aliases[cmd]) cmd = aliases[cmd];
    const command = bot.commands.get(cmd);
    if (!command) return;
    try { command.execute(message, args); } catch (e) { addLog(`❌ ${e.message}`); message.reply('❌ خطأ!'); }
  });

  bot.on('raw', (d) => manager.updateVoiceState(d));

  bot.on('ready', () => {
    addLog(`✅ ${bot.user.tag} شغال!`);
    manager.init(bot.user.id);
  });
}

// API
app.post('/api/start', async (req, res) => {
  const { token, spotifyId, spotifySecret } = req.body;
  if (bot) return res.json({ success: false, error: 'شغال!' });
  if (!token || token.length < 50) return res.json({ success: false, error: 'توكن غلط!' });

  botToken = token;
  try {
    bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates] });

    // Pass Spotify credentials
    process.env.SPOTIFY_CLIENT_ID = spotifyId || '';
    process.env.SPOTIFY_CLIENT_SECRET = spotifySecret || '';

    setupMusic();
    setupCommands();
    setupEvents();
    await bot.login(token);
    botStatus = 'online';
    res.json({ success: true });
  } catch (e) { bot = null; botStatus = 'offline'; res.json({ success: false, error: e.message }); }
});

app.post('/api/stop', async (req, res) => {
  if (!bot) return res.json({ success: false, error: 'مو شغال!' });
  manager.nodes.forEach(n => n.destroy());
  await bot.destroy(); bot = null; botStatus = 'offline'; addLog('🛑 توقف'); res.json({ success: true });
});

app.get('/api/status', (req, res) => res.json({ status: botStatus, tag: bot?.user?.tag || null, guilds: bot?.guilds?.cache?.size || 0 }));
app.get('/api/logs', (req, res) => res.json(logs));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Music Bot: http://localhost:${PORT}`));
