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

// ========== CONFIG ==========
const CONFIG = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN || '',
  SPOTIFY_CLIENT_ID: process.env.SPOTIFY_ID || '',
  SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_SECRET || '',
  LAVA_HOST: process.env.LAVA_HOST || 'lavalink-v4.teramont.net',
  LAVA_PORT: parseInt(process.env.LAVA_PORT) || 443,
  LAVA_PASSWORD: process.env.LAVA_PASSWORD || 'eHKuFcz67k4lBS64',
  LAVA_SECURE: process.env.LAVA_SECURE !== 'false'
};

let bot = null;
let botStatus = 'offline';
let logs = [];
let manager = null;

function addLog(msg) {
  const time = new Date().toLocaleTimeString('ar-SA');
  const log = `[${time}] ${msg}`;
  logs.push(log);
  if (logs.length > 100) logs.shift();
  wss.clients.forEach(c => {
    if (c.readyState === 1) c.send(JSON.stringify({ type: 'log', message: log }));
  });
}

const wss = new WebSocket.Server({ server });
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'status', status: botStatus }));
  logs.forEach(l => ws.send(JSON.stringify({ type: 'log', message: l })));
});

// ========== MUSIC SETUP ==========

function setupMusic() {
  const plugins = [];
  
  if (CONFIG.SPOTIFY_CLIENT_ID && CONFIG.SPOTIFY_CLIENT_SECRET) {
    plugins.push(new Spotify({
      clientID: CONFIG.SPOTIFY_CLIENT_ID,
      clientSecret: CONFIG.SPOTIFY_CLIENT_SECRET
    }));
    addLog('✅ Spotify plugin loaded');
  } else {
    addLog('⚠️ Spotify not configured - SoundCloud/YouTube only');
  }

  manager = new Manager({
    nodes: [{
      host: CONFIG.LAVA_HOST,
      port: CONFIG.LAVA_PORT,
      password: CONFIG.LAVA_PASSWORD,
      secure: CONFIG.LAVA_SECURE
    }],
    plugins: plugins,
    send(id, payload) {
      const guild = bot.guilds.cache.get(id);
      if (guild) guild.shard.send(payload);
    }
  });

  manager.on('nodeConnect', (node) => {
    addLog(`🎵 Lavalink connected: ${node.options.identifier}`);
  });

  manager.on('nodeError', (node, error) => {
    addLog(`❌ Lavalink error: ${error.message}`);
  });

  manager.on('trackStart', (player, track) => {
    const channel = bot.channels.cache.get(player.textChannel);
    if (channel) {
      const embed = new EmbedBuilder()
        .setColor(0x808080)
        .setTitle('▶️ الأغنية الحالية')
        .setDescription(`**${track.title}**`)
        .addFields(
          { name: 'الفنان', value: track.author, inline: true },
          { name: 'المدة', value: formatTime(track.duration), inline: true },
          { name: 'المصدر', value: track.sourceName || 'Unknown', inline: true }
        )
        .setThumbnail(track.displayThumbnail?.('maxresdefault') || null);
      channel.send({ embeds: [embed] });
    }
  });

  manager.on('queueEnd', (player) => {
    addLog('⏹️ Queue ended');
    player.destroy();
  });

  manager.on('trackError', (player, track, error) => {
    addLog(`❌ Track error: ${error}`);
    const channel = bot.channels.cache.get(player.textChannel);
    if (channel) channel.send('❌ صار خطأ في الأغنية!');
  });
}

function formatTime(ms) {
  if (!ms || ms === Infinity) return 'Live';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ========== COMMANDS ==========

function setupCommands() {
  bot.commands = new Collection();

  // PLAY
  bot.commands.set('play', {
    name: 'play',
    aliases: ['شغل', 'p'],
    description: 'يشغل أغنية من Spotify, SoundCloud, YouTube',
    async execute(message, args) {
      const query = args.join(' ');
            if (!query) return message.reply("❌ اكتب اسم الأغنية أو الرابط!\n\n**أمثلة:**\n`!play Drake God's Plan`\n`!play https://open.spotify.com/track/...`\n`!play https://soundcloud.com/...`");
      
      if (!voiceChannel) return message.reply('❌ ادخل روم صوتي الأول!');

      const permissions = voiceChannel.permissionsFor(message.client.user);
      if (!permissions.has('Connect') || !permissions.has('Speak')) {
        return message.reply('❌ البوت ما عنده صلاحية يدخل الروم!');
      }

      const player = manager.create({
        guild: message.guild.id,
        voiceChannel: voiceChannel.id,
        textChannel: message.channel.id
      });

      if (player.state !== 'CONNECTED') player.connect();

      message.channel.send(`🔍 جاري البحث عن: **${query}**...`);

      try {
        const search = await manager.search(query, message.author);
        
        if (search.loadType === 'LOAD_FAILED') {
          return message.reply('❌ صار خطأ في البحث!');
        }
        
        if (search.loadType === 'NO_MATCHES') {
          return message.reply('❌ ما لقيت شي! جرب:\n- اسم مختلف\n- رابط مباشر\n- تأكد من إعدادات Spotify');
        }

        let track;
        let playlistName = null;

        if (search.loadType === 'PLAYLIST_LOADED') {
          track = search.tracks[0];
          playlistName = search.playlist.name;
          for (const t of search.tracks) {
            player.queue.add(t);
          }
        } else {
          track = search.tracks[0];
          player.queue.add(track);
        }

        const embed = new EmbedBuilder()
          .setColor(0x808080)
          .setTitle(playlistName ? '🎵 أضيفت قائمة التشغيل' : '🎵 أضيفت للقائمة')
          .setDescription(`**${track.title}**`)
          .addFields(
            { name: 'الفنان', value: track.author, inline: true },
            { name: 'المدة', value: formatTime(track.duration), inline: true },
            { name: 'المصدر', value: track.sourceName || 'Unknown', inline: true }
          )
          .setThumbnail(track.displayThumbnail?.('maxresdefault') || message.author.displayAvatarURL());

        if (playlistName) {
          embed.addFields({ name: 'القائمة', value: `${search.tracks.length} أغنية`, inline: true });
        }

        message.reply({ embeds: [embed] });

        if (!player.playing && !player.paused && player.queue.size === (playlistName ? search.tracks.length : 1)) {
          player.play();
        }

      } catch (err) {
        addLog(`❌ Search error: ${err.message}`);
        message.reply('❌ صار خطأ! جرب لاحقاً.');
      }
    }
  });

  // SKIP
  bot.commands.set('skip', {
    name: 'skip',
    aliases: ['تخطي', 's', 'next', 'التالي'],
    description: 'يتخطى الأغنية الحالية',
    execute(message) {
      const player = manager.get(message.guild.id);
      if (!player || !player.queue.current) return message.reply('❌ ما في شي شغال!');
      
      const current = player.queue.current;
      player.stop();
      message.reply(`⏭️ تخطيت: **${current.title}**`);
    }
  });

  // STOP
  bot.commands.set('stop', {
    name: 'stop',
    aliases: ['وقف', 'st', 'end'],
    description: 'يوقف ويمسح القائمة',
    execute(message) {
      const player = manager.get(message.guild.id);
      if (!player) return message.reply('❌ ما في شي شغال!');
      
      player.destroy();
      message.reply('⏹️ وقفت ومسحت القائمة!');
    }
  });

  // QUEUE
  bot.commands.set('queue', {
    name: 'queue',
    aliases: ['قائمة', 'q', 'list'],
    description: 'يعرض قائمة الأغاني',
    execute(message) {
      const player = manager.get(message.guild.id);
      if (!player || !player.queue.size) return message.reply('❌ القائمة فاضية!');

      const current = player.queue.current;
      const upcoming = player.queue.slice(0, 10);
      
      let description = '';
      if (current) {
        description += `**▶️ الحين:** ${current.title} - ${current.author}\n\n`;
      }
      
      description += upcoming.map((t, i) => `${i + 1}. **${t.title}** - ${t.author} (${formatTime(t.duration)})`).join('\n');

      const embed = new EmbedBuilder()
        .setColor(0x808080)
        .setTitle('🎵 قائمة الأغاني')
        .setDescription(description)
        .setFooter({ text: `${player.queue.size} أغنية | Loop: ${player.queueRepeat ? '✅' : '❌'} | Volume: ${player.volume}%` });

      message.reply({ embeds: [embed] });
    }
  });

  // LOOP
  bot.commands.set('loop', {
    name: 'loop',
    aliases: ['تكرار', 'l', 'repeat'],
    description: 'يشغل/يطفي التكرار',
    execute(message) {
      const player = manager.get(message.guild.id);
      if (!player) return message.reply('❌ ما في شي شغال!');
      
      player.setQueueRepeat(!player.queueRepeat);
      message.reply(`🔁 التكرار: ${player.queueRepeat ? '**شغال** ✅' : '**طافي** ❌'}`);
    }
  });

  // NOW PLAYING
  bot.commands.set('np', {
    name: 'np',
    aliases: ['الحين', 'now', 'playing', 'اللي شغال'],
    description: 'يعرض الأغنية الحالية',
    execute(message) {
      const player = manager.get(message.guild.id);
      if (!player || !player.queue.current) return message.reply('❌ ما في شي شغال!');

      const track = player.queue.current;
      const position = formatTime(player.position);
      const duration = formatTime(track.duration);
      const progress = track.duration > 0 ? Math.floor((player.position / track.duration) * 20) : 0;
      const bar = '▬'.repeat(progress) + '🔘' + '▬'.repeat(20 - progress);

      const embed = new EmbedBuilder()
        .setColor(0x808080)
        .setTitle('▶️ الأغنية الحالية')
        .setDescription(`**${track.title}**`)
        .addFields(
          { name: 'الفنان', value: track.author, inline: true },
          { name: 'التقدم', value: `${bar}\n${position} / ${duration}`, inline: false },
          { name: 'طلبها', value: track.requester?.toString() || 'Unknown', inline: true },
          { name: 'المصدر', value: track.sourceName || 'Unknown', inline: true }
        )
        .setThumbnail(track.displayThumbnail?.('maxresdefault') || message.author.displayAvatarURL());

      message.reply({ embeds: [embed] });
    }
  });

  // PAUSE
  bot.commands.set('pause', {
    name: 'pause',
    aliases: ['وقف مؤقت', 'ps', 'hold'],
    description: 'يوقف مؤقتاً',
    execute(message) {
      const player = manager.get(message.guild.id);
      if (!player) return message.reply('❌ ما في شي شغال!');
      
      player.pause(true);
      message.reply('⏸️ وقفت مؤقتاً!');
    }
  });

  // RESUME
  bot.commands.set('resume', {
    name: 'resume',
    aliases: ['كمل', 'rs', 'continue'],
    description: 'يكمل الأغنية',
    execute(message) {
      const player = manager.get(message.guild.id);
      if (!player) return message.reply('❌ ما في شي شغال!');
      
      player.pause(false);
      message.reply('▶️ كملت!');
    }
  });

  // VOLUME
  bot.commands.set('volume', {
    name: 'volume',
    aliases: ['صوت', 'vol', 'v'],
    description: 'يغير مستوى الصوت (1-150)',
    execute(message, args) {
      const player = manager.get(message.guild.id);
      if (!player) return message.reply('❌ ما في شي شغال!');

      const vol = parseInt(args[0]);
      if (!vol || vol < 1 || vol > 150) return message.reply('❌ اكتب رقم من 1-150!');

      player.setVolume(vol);
      message.reply(`🔊 مستوى الصوت: **${vol}%**`);
    }
  });

  // LEAVE
  bot.commands.set('leave', {
    name: 'leave',
    aliases: ['طل', 'اخرج', 'dc', 'disconnect', 'stop'],
    description: 'يخرج من الروم الصوتي',
    execute(message) {
      const player = manager.get(message.guild.id);
      if (player) player.destroy();
      message.reply('👋 طلعت من الروم!');
    }
  });

  // SHUFFLE
  bot.commands.set('shuffle', {
    name: 'shuffle',
    aliases: ['عشوائي', 'random', 'mix'],
    description: 'يخلط القائمة',
    execute(message) {
      const player = manager.get(message.guild.id);
      if (!player || player.queue.size < 2) return message.reply('❌ ما يكفي أغاني!');

      player.queue.shuffle();
      message.reply('🔀 خلطت القائمة!');
    }
  });

  // REMOVE
  bot.commands.set('remove', {
    name: 'remove',
    aliases: ['شيل', 'rm', 'delete'],
    description: 'يشيل أغنية من القائمة',
    execute(message, args) {
      const player = manager.get(message.guild.id);
      if (!player) return message.reply('❌ ما في شي!');

      const index = parseInt(args[0]) - 1;
      if (isNaN(index) || index < 0 || index >= player.queue.size) {
        return message.reply('❌ رقم غلط! استخدم `!queue` تشوف الأرقام.');
      }

      const removed = player.queue.remove(index);
      message.reply(`🗑️ شلت: **${removed.title}**`);
    }
  });

  // SEEK
  bot.commands.set('seek', {
    name: 'seek',
    aliases: ['انتقل', 'jump', 'go'],
    description: 'ينتقل لوقت معين (بالثواني)',
    execute(message, args) {
      const player = manager.get(message.guild.id);
      if (!player) return message.reply('❌ ما في شي شغال!');

      const time = parseInt(args[0]);
      if (!time || time < 0) return message.reply('❌ اكتب الوقت بالثواني!');

      player.seek(time * 1000);
      message.reply(`⏩ انتقلت لـ **${formatTime(time * 1000)}**`);
    }
  });

  // HELP
  bot.commands.set('help', {
    name: 'help',
    aliases: ['مساعدة', 'h', 'commands', 'اوامر'],
    description: 'قائمة الأوامر',
    execute(message) {
      const embed = new EmbedBuilder()
        .setColor(0x808080)
        .setTitle('🎵 أوامر الموسيقى')
        .setDescription('**المصادر:** Spotify, SoundCloud, YouTube, Apple Music, Deezer')
        .addFields(
          { name: '🎵 تشغيل', value: '`!play [اسم/رابط]` - يبحث ويشغل' },
          { name: '⏭️ تخطي', value: '`!skip` - يتخطى' },
          { name: '⏹️ إيقاف', value: '`!stop` - يوقف ويمسح' },
          { name: '📜 قائمة', value: '`!queue` - يعرض الأغاني' },
          { name: '🔁 تكرار', value: '`!loop` - يشغل/يطفي التكرار' },
          { name: '▶️ الحين', value: '`!np` - الأغنية الحالية' },
          { name: '⏸️ توقف مؤقت', value: '`!pause` - يوقف مؤقتاً' },
          { name: '▶️ كمل', value: '`!resume` - يكمل' },
          { name: '🔊 صوت', value: '`!volume [1-150]` - يغير الصوت' },
          { name: '🔀 عشوائي', value: '`!shuffle` - يخلط القائمة' },
          { name: '🗑️ شيل', value: '`!remove [رقم]` - يشيل أغنية' },
          { name: '⏩ انتقال', value: '`!seek [ثواني]` - ينتقل لوقت' },
          { name: '👋 خروج', value: '`!leave` - يخرج من الروم' }
        )
        .setFooter({ text: 'بدون حماية YouTube - يشتغل 24/7' });

      message.reply({ embeds: [embed] });
    }
  });
}

// ========== EVENTS ==========

function setupEvents() {
  bot.on('messageCreate', (message) => {
    if (message.author.bot || !message.guild) return;

    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    let cmdName = args.shift().toLowerCase();

    // Aliases map
    const aliases = {
      'شغل': 'play', 'p': 'play',
      'تخطي': 'skip', 's': 'skip', 'next': 'skip', 'التالي': 'skip',
      'وقف': 'stop', 'st': 'stop', 'end': 'stop',
      'قائمة': 'queue', 'q': 'queue', 'list': 'queue',
      'تكرار': 'loop', 'l': 'loop', 'repeat': 'loop',
      'الحين': 'np', 'now': 'np', 'playing': 'np', 'اللي شغال': 'np',
      'وقف مؤقت': 'pause', 'ps': 'pause', 'hold': 'pause',
      'كمل': 'resume', 'rs': 'resume', 'continue': 'resume',
      'صوت': 'volume', 'vol': 'volume', 'v': 'volume',
      'طل': 'leave', 'اخرج': 'leave', 'dc': 'leave', 'disconnect': 'leave',
      'عشوائي': 'shuffle', 'random': 'shuffle', 'mix': 'shuffle',
      'شيل': 'remove', 'rm': 'remove', 'delete': 'remove',
      'انتقل': 'seek', 'jump': 'seek', 'go': 'seek',
      'مساعدة': 'help', 'h': 'help', 'commands': 'help', 'اوامر': 'help'
    };

    if (aliases[cmdName]) cmdName = aliases[cmdName];

    const cmd = bot.commands.get(cmdName);
    if (!cmd) return;

    try {
      cmd.execute(message, args);
    } catch (err) {
      addLog(`❌ Command error: ${err.message}`);
      message.reply('❌ صار خطأ!');
    }
  });

  bot.on('raw', (d) => manager.updateVoiceState(d));

  bot.on('ready', () => {
    addLog(`✅ ${bot.user.tag} شغال!`);
    addLog(`🎵 Music Bot - Lavalink + Spotify`);
    manager.init(bot.user.id);
  });
}

// ========== API ==========

app.post('/api/start', async (req, res) => {
  const { token, spotifyId, spotifySecret, lavaHost, lavaPort, lavaPassword } = req.body;
  
  if (bot) return res.json({ success: false, error: 'البوت شغال!' });
  if (!token || token.length < 50) return res.json({ success: false, error: 'توكن غلط!' });

  // Update config
  if (spotifyId) CONFIG.SPOTIFY_CLIENT_ID = spotifyId;
  if (spotifySecret) CONFIG.SPOTIFY_CLIENT_SECRET = spotifySecret;
  if (lavaHost) CONFIG.LAVA_HOST = lavaHost;
  if (lavaPort) CONFIG.LAVA_PORT = lavaPort;
  if (lavaPassword) CONFIG.LAVA_PASSWORD = lavaPassword;

  try {
    bot = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
      ]
    });

    setupMusic();
    setupCommands();
    setupEvents();
    
    await bot.login(token);
    botStatus = 'online';
    res.json({ success: true });
  } catch (err) {
    bot = null;
    botStatus = 'offline';
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/stop', async (req, res) => {
  if (!bot) return res.json({ success: false, error: 'البوت مو شغال!' });
  
  try {
    manager.nodes.forEach(n => n.destroy());
    await bot.destroy();
    bot = null;
    botStatus = 'offline';
    addLog('🛑 البوت توقف');
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/status', (req, res) => {
  const player = bot ? manager?.get(Array.from(manager.players.keys())[0]) : null;
  res.json({
    status: botStatus,
    tag: bot?.user?.tag || null,
    guilds: bot?.guilds?.cache?.size || 0,
    nodes: manager?.nodes?.size || 0,
    players: manager?.players?.size || 0
  });
});

app.get('/api/logs', (req, res) => res.json(logs));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎵 Music Bot: http://localhost:${PORT}`));
