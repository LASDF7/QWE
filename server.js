const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const { Client, GatewayIntentBits, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, PermissionFlagsBits, AttachmentBuilder } = require('discord.js');
const { joinVoiceChannel, VoiceConnectionStatus, entersState } = require('@discordjs/voice');

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static('public'));

let bot = null;
let botStatus = 'offline';
let logs = [];
let botToken = '';

function addLog(msg) {
  const time = new Date().toLocaleTimeString('ar-SA');
  const log = `[${time}] ${msg}`;
  logs.push(log);
  if (logs.length > 100) logs.shift();

  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(JSON.stringify({ type: 'log', message: log }));
    }
  });
}

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'status', status: botStatus }));
  logs.forEach(log => ws.send(JSON.stringify({ type: 'log', message: log })));
});

// ========== BOT ==========

function isAdmin(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild);
}

function isModerator(member) {
  return member.permissions.has(PermissionFlagsBits.ManageMessages) || member.permissions.has(PermissionFlagsBits.KickMembers) || member.permissions.has(PermissionFlagsBits.BanMembers) || isAdmin(member);
}

function getXPForLevel(level) {
  return Math.floor(100 * Math.pow(1.5, level - 1));
}

function addXP(userId, guildId, amount) {
  const key = `${guildId}-${userId}`;
  if (!bot.levels.has(key)) bot.levels.set(key, { level: 1, xp: 0, totalMessages: 0, voiceTime: 0 });
  const data = bot.levels.get(key);
  data.xp += amount;
  data.totalMessages++;
  let needed = getXPForLevel(data.level);
  let leveledUp = false;
  let oldLevel = data.level;
  while (data.xp >= needed) {
    data.xp -= needed;
    data.level++;
    leveledUp = true;
    oldLevel = data.level - 1;
    needed = getXPForLevel(data.level);
  }
  bot.levels.set(key, data);
  return { leveledUp, oldLevel, newLevel: data.level, data };
}

function addPoints(userId, guildId, amount) {
  const key = `${guildId}-${userId}`;
  if (!bot.points.has(key)) bot.points.set(key, { points: 0, totalEarned: 0, spent: 0 });
  const data = bot.points.get(key);
  data.points += amount;
  data.totalEarned += amount;
  bot.points.set(key, data);
  return data;
}

function registerCommand(name, aliases, options) {
  bot.commands.set(name, { name, aliases, ...options });
  if (aliases) aliases.forEach(alias => bot.aliases.set(alias, name));
}

// ========== COMMANDS ==========

function setupCommands() {
  registerCommand('ping', ['بنق', 'p'], { category: 'عام', description: 'سرعة البوت', execute(message) { message.reply(`Pong! ${Date.now() - message.createdTimestamp}ms | API: ${Math.round(bot.ws.ping)}ms`); } });
  registerCommand('say', ['قل', 's'], { category: 'عام', description: 'يكرر كلامك', execute(message, args) { const text = args.join(' '); if (!text) return message.reply('اكتب شيء!'); message.channel.send(text); message.delete().catch(() => {}); } });
  registerCommand('embed', ['ايمبد', 'em'], { category: 'عام', description: 'يرسل رسالة كـ Embed مع صورة اختيارية', execute(message, args) {
    const text = args.join(' ');
    if (!text) return message.reply('اكتب شيء!');
    let imageUrl = null;
    let description = text;
    const imgMatch = text.match(/\[img:(https?:\/\/[^\]]+)\]/);
    if (imgMatch) {
      imageUrl = imgMatch[1];
      description = text.replace(imgMatch[0], '').trim();
    }
    const embed = new EmbedBuilder().setColor(0x808080).setDescription(description).setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() }).setTimestamp();
    if (imageUrl) embed.setImage(imageUrl);
    message.channel.send({ embeds: [embed] });
    message.delete().catch(() => {});
  } });
  registerCommand('userinfo', ['معلومات', 'ui'], { category: 'عام', description: 'معلومات العضو', execute(message) { const user = message.mentions.users.first() || message.author; const member = message.guild.members.cache.get(user.id); message.reply({ embeds: [{ color: 0x808080, title: `معلومات ${user.username}`, thumbnail: { url: user.displayAvatarURL() }, fields: [{ name: 'الايدي', value: user.id }, { name: 'الانضمام', value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'غير معروف' }, { name: 'الحساب', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>` }, { name: 'بوت؟', value: user.bot ? 'نعم' : 'لا' }, { name: 'الرتب', value: member ? member.roles.cache.map(r => r.name).slice(0, 5).join(', ') || 'بدون' : 'غير معروف' }] }] }); } });
  registerCommand('serverinfo', ['سيرفر', 'si'], { category: 'عام', description: 'معلومات السيرفر', execute(message) { const g = message.guild; message.reply({ embeds: [{ color: 0x808080, title: g.name, thumbnail: { url: g.iconURL() }, fields: [{ name: 'الاعضاء', value: `${g.memberCount}` }, { name: 'الرومات', value: `${g.channels.cache.size}` }, { name: 'الرتب', value: `${g.roles.cache.size}` }, { name: 'المالك', value: `<@${g.ownerId}>` }, { name: 'التاريخ', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>` }, { name: 'البوتات', value: `${g.members.cache.filter(m => m.user.bot).size}` }] }] }); } });
  registerCommand('avatar', ['صورة', 'av'], { category: 'عام', description: 'صورة البروفايل', execute(message) { const user = message.mentions.users.first() || message.author; message.reply({ embeds: [{ color: 0x808080, title: `صورة ${user.username}`, image: { url: user.displayAvatarURL({ size: 4096 }) } }] }); } });
  registerCommand('banner', ['بانر', 'bn'], { category: 'عام', description: 'بانر العضو', execute(message) { const user = message.mentions.users.first() || message.author; message.reply({ embeds: [{ color: 0x808080, title: `بانر ${user.username}`, image: { url: user.bannerURL({ size: 4096 }) || 'https://via.placeholder.com/600x240?text=No+Banner' } }] }); } });
  registerCommand('id', ['ايدي', 'i'], { category: 'عام', description: 'صورة الايدي', execute(message) { const user = message.mentions.users.first() || message.author; const member = message.guild.members.cache.get(user.id); message.reply({ embeds: [{ color: 0x808080, title: user.username, image: { url: user.displayAvatarURL({ size: 4096 }) }, fields: [{ name: 'الايدي', value: user.id }, { name: 'الانضمام', value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'غير معروف' }, { name: 'الحساب', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>` }] }] }); } });
  registerCommand('roles', ['رتب', 'r'], { category: 'عام', description: 'رتب العضو', execute(message) { const member = message.mentions.members.first() || message.member; const roles = member.roles.cache.filter(r => r.id !== message.guild.id).sort((a, b) => b.position - a.position); message.reply({ embeds: [{ color: 0x808080, title: `رتب ${member.user.username}`, description: roles.map(r => `<@&${r.id}>`).join(', ') || 'بدون رتب', footer: { text: `العدد: ${roles.size}` } }] }); } });
  registerCommand('botinfo', ['بوت', 'bi'], { category: 'عام', description: 'معلومات البوت', execute(message) { message.reply({ embeds: [{ color: 0x808080, title: 'معلومات البوت', fields: [{ name: 'الاسم', value: bot.user.tag }, { name: 'السيرفرات', value: `${bot.guilds.cache.size}` }, { name: 'المستخدمين', value: `${bot.users.cache.size}` }, { name: 'البنق', value: `${Math.round(bot.ws.ping)}ms` }, { name: 'وقت التشغيل', value: `<t:${Math.floor((Date.now() - process.uptime() * 1000) / 1000)}:R>` }] }] }); } });
  registerCommand('invite', ['دعوة', 'inv'], { category: 'عام', description: 'رابط دعوة البوت', execute(message) { message.reply(`رابط الدعوة:
https://discord.com/api/oauth2/authorize?client_id=${bot.user.id}&permissions=8&scope=bot%20applications.commands`); } });
  registerCommand('rank', ['لفل', 'لفلي', 'rl'], { category: 'لفل', description: 'لفلك ونقاطك', execute(message) { const target = message.mentions.users.first() || message.author; const key = `${message.guild.id}-${target.id}`; const data = bot.levels.get(key) || { level: 1, xp: 0, totalMessages: 0, voiceTime: 0 }; const needed = getXPForLevel(data.level); const progress = Math.floor((data.xp / needed) * 10); const bar = '█'.repeat(progress) + '░'.repeat(10 - progress); message.reply({ embeds: [{ color: 0x808080, title: `${target.username}`, image: { url: target.displayAvatarURL({ size: 4096 }) }, fields: [{ name: 'اللفل', value: `${data.level}` }, { name: 'النقاط', value: `${data.xp}/${needed}` }, { name: 'التقدم', value: `[${bar}] ${Math.floor((data.xp/needed)*100)}%` }, { name: 'الرسائل', value: `${data.totalMessages}` }, { name: 'وقت الصوت', value: `${Math.floor(data.voiceTime / 60)}د` }], footer: { text: `اللفل القادم يحتاج ${needed} نقطة` } }] }); } });
  registerCommand('leaderboard', ['ليدر', 'توب', 'lb'], { category: 'لفل', description: 'أعلى 10 باللفل', execute(message) { const all = Array.from(bot.levels.entries()).filter(([key]) => key.startsWith(message.guild.id)).sort((a, b) => b[1].level - a[1].level || b[1].xp - a[1].xp).slice(0, 10); const list = all.map(([key, data], i) => { const userId = key.split('-')[1]; return `${i + 1}. <@${userId}> - لفل ${data.level} (${data.xp} نقطة)`; }).join('\n') || 'لا يوجد بيانات'; message.reply({ embeds: [{ color: 0x808080, title: 'ليدربورد اللفل', description: list }] }); } });
  registerCommand('points', ['نقاط', 'نقاطي', 'pt'], { category: 'لفل', description: 'نقاطك', execute(message) { const target = message.mentions.users.first() || message.author; const key = `${message.guild.id}-${target.id}`; const data = bot.points.get(key) || { points: 0, totalEarned: 0, spent: 0 }; message.reply({ embeds: [{ color: 0x808080, title: `نقاط ${target.username}`, fields: [{ name: 'المتاحة', value: `${data.points}` }, { name: 'مجموع المكتسبة', value: `${data.totalEarned}` }, { name: 'المصروفة', value: `${data.spent}` }] }] }); } });
  registerCommand('addxp', ['اضافة-لفل', 'axp'], { category: 'ادارة', description: 'إضافة XP', execute(message, args) { if (!isModerator(message.member)) return message.reply('للإدارة فقط!'); const target = message.mentions.users.first(); if (!target) return message.reply('منشن العضو!'); const amount = parseInt(args[1]); if (!amount) return message.reply('اكتب الكمية!'); const result = addXP(target.id, message.guild.id, amount); message.reply(result.leveledUp ? `${target} وصل للفل ${result.newLevel}!` : `تم إضافة ${amount} نقطة`); } });
  registerCommand('resetxp', ['تصفير-لفل', 'rxp'], { category: 'ادارة', description: 'تصفير لفل', execute(message) { if (!isAdmin(message.member)) return message.reply('للأدمن فقط!'); const target = message.mentions.users.first(); if (!target) return message.reply('منشن العضو!'); bot.levels.set(`${message.guild.id}-${target.id}`, { level: 1, xp: 0, totalMessages: 0, voiceTime: 0 }); message.reply(`تم تصفير لفل ${target}`); } });
  registerCommand('clear', ['مسح', 'حذف', 'c'], { category: 'ادارة', description: 'حذف رسائل', async execute(message, args) { if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return message.reply('ما عندك صلاحية!'); const amount = parseInt(args[0]); if (!amount || amount < 1 || amount > 99) return message.reply('اكتب رقم من 1-99!'); try { await message.channel.bulkDelete(amount + 1, true); const msg = await message.channel.send(`تم حذف ${amount} رسالة`); setTimeout(() => msg.delete().catch(() => {}), 3000); } catch { message.reply('صار خطأ'); } } });
  registerCommand('kick', ['طرد', 'k'], { category: 'ادارة', description: 'طرد عضو', execute(message, args) { if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) return message.reply('ما عندك صلاحية!'); const user = message.mentions.users.first(); if (!user) return message.reply('منشن شخص!'); message.guild.members.cache.get(user.id).kick(args.slice(1).join(' ') || 'بدون سبب').then(() => message.reply(`تم طرد ${user.username}`)).catch(() => message.reply('ما قدرت!')); } });
  registerCommand('ban', ['قمنقلع', 'b'], { category: 'ادارة', description: 'حظر عضو', execute(message, args) { if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) return message.reply('ما عندك صلاحية!'); const user = message.mentions.users.first(); if (!user) return message.reply('منشن شخص!'); message.guild.members.cache.get(user.id).ban({ reason: args.slice(1).join(' ') || 'بدون سبب' }).then(() => message.reply(`تم حظر ${user.username}`)).catch(() => message.reply('ما قدرت!')); } });
  registerCommand('unban', ['فك', 'ub'], { category: 'ادارة', description: 'فك حظر', execute(message, args) { if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) return message.reply('ما عندك صلاحية!'); const userId = args[0]; if (!userId) return message.reply('اكتب الايدي!'); message.guild.members.unban(userId).then(() => message.reply(`تم فك حظر ${userId}`)).catch(() => message.reply('ما قدرت!')); } });
  registerCommand('mute', ['اسكت', 'm'], { category: 'ادارة', description: 'كتم عضو', execute(message, args) { if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply('ما عندك صلاحية!'); const target = message.mentions.members.first(); if (!target) return message.reply('منشن العضو!'); const d = args[1] || '1h'; const ms = d.endsWith('m') ? parseInt(d) * 60000 : d.endsWith('h') ? parseInt(d) * 3600000 : d.endsWith('d') ? parseInt(d) * 86400000 : 3600000; target.timeout(ms, args.slice(2).join(' ') || 'بدون سبب').then(() => message.reply(`تم كتم ${target.user.username} لمدة ${d}`)).catch(() => message.reply('ما قدرت!')); } });
  registerCommand('unmute', ['تكلم', 'um'], { category: 'ادارة', description: 'فك كتم', execute(message) { if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply('ما عندك صلاحية!'); const target = message.mentions.members.first(); if (!target) return message.reply('منشن العضو!'); target.timeout(null).then(() => message.reply(`تم فك كتم ${target.user.username}`)).catch(() => message.reply('ما قدرت!')); } });
  registerCommand('warn', ['ات', 'w'], { category: 'ادارة', description: 'إنذار عضو', execute(message, args) { if (!isModerator(message.member)) return message.reply('للإدارة فقط!'); const target = message.mentions.users.first(); if (!target) return message.reply('منشن العضو!'); const key = `${message.guild.id}-${target.id}`; if (!bot.warnings.has(key)) bot.warnings.set(key, []); bot.warnings.get(key).push({ reason: args.slice(1).join(' ') || 'بدون سبب', by: message.author.id, date: new Date() }); const count = bot.warnings.get(key).length; message.reply(`تم إنذار ${target} | إنذارات: ${count}/3`); if (count >= 3) { const m = message.guild.members.cache.get(target.id); if (m) m.kick('3 إنذارات').catch(() => {}); } } });
  registerCommand('warnings', ['تحذيرات', 'ws'], { category: 'ادارة', description: 'عرض إنذارات', execute(message) { if (!isModerator(message.member)) return message.reply('للإدارة فقط!'); const target = message.mentions.users.first() || message.author; const key = `${message.guild.id}-${target.id}`; const warns = bot.warnings.get(key) || []; if (!warns.length) return message.reply('لا يوجد إنذارات'); message.reply({ embeds: [{ color: 0x808080, title: `إنذارات ${target.username}`, description: warns.map((w, i) => `${i + 1}. ${w.reason} - <@${w.by}>`).join('\n'), footer: { text: `العدد: ${warns.length}/3` } }] }); } });
  registerCommand('unwarn', ['شيل', 'uw'], { category: 'ادارة', description: 'حذف إنذار', execute(message, args) { if (!isAdmin(message.member)) return message.reply('للأدمن فقط!'); const target = message.mentions.users.first(); if (!target) return message.reply('منشن العضو!'); const key = `${message.guild.id}-${target.id}`; const warns = bot.warnings.get(key); if (!warns?.length) return message.reply('لا يوجد إنذارات'); const index = parseInt(args[1]) - 1; if (isNaN(index) || index < 0 || index >= warns.length) return message.reply('رقم غير صحيح!'); warns.splice(index, 1); message.reply(`تم حذف الإنذار ${index + 1}`); } });
  registerCommand('slowmode', ['بطيء', 'sm'], { category: 'ادارة', description: 'بطيء للروم', execute(message, args) { if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply('ما عندك صلاحية!'); const s = parseInt(args[0]); if (s === undefined) return message.reply('اكتب الثواني!'); message.channel.setRateLimitPerUser(s).then(() => message.reply(s ? `تم تعيين بطيء: ${s} ثانية` : 'تم إلغاء البطيء')).catch(() => message.reply('ما قدرت!')); } });
  registerCommand('lock', ['قفل', 'ق'], { category: 'ادارة', description: 'قفل الروم', execute(message) { if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply('ما عندك صلاحية!'); message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: false }).then(() => message.reply('تم قفل الروم')).catch(() => message.reply('ما قدرت!')); } });
  registerCommand('unlock', ['فتح', 'ف'], { category: 'ادارة', description: 'فتح الروم', execute(message) { if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply('ما عندك صلاحية!'); message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: true }).then(() => message.reply('تم فتح الروم')).catch(() => message.reply('ما قدرت!')); } });
  registerCommand('nick', ['لقب', 'n'], { category: 'ادارة', description: 'تغيير لقب', execute(message, args) { if (!message.member.permissions.has(PermissionFlagsBits.ManageNicknames)) return message.reply('ما عندك صلاحية!'); const target = message.mentions.members.first(); if (!target) return message.reply('منشن العضو!'); target.setNickname(args.slice(1).join(' ') || null).then(() => message.reply('تم تغيير اللقب')).catch(() => message.reply('ما قدرت!')); } });
  registerCommand('role', ['رتبة', 'rol'], { category: 'ادارة', description: 'إعطاء/سحب رتبة', execute(message, args) { if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply('ما عندك صلاحية!'); const target = message.mentions.members.first(); const role = message.mentions.roles.first(); if (!target || !role) return message.reply('منشن العضو والرتبة!'); if (target.roles.cache.has(role.id)) { target.roles.remove(role).then(() => message.reply(`تم سحب ${role.name}`)); } else { target.roles.add(role).then(() => message.reply(`تم إعطاء ${role.name}`)); } } });
  registerCommand('announce', ['اعلان', 'ann'], { category: 'ادارة', description: 'إرسال إعلان', execute(message, args) { if (!isAdmin(message.member)) return message.reply('للأدمن فقط!'); const channel = message.mentions.channels.first() || message.channel; const text = args.join(' ').replace(/<<#\d+>/, '').trim(); if (!text) return message.reply('اكتب نص الإعلان!'); channel.send({ embeds: [{ color: 0x808080, title: 'إعلان', description: text, footer: { text: `بواسطة ${message.author.username}` }, timestamp: new Date() }] }); message.delete().catch(() => {}); } });
  registerCommand('تكت', ['تذكرة', 'tk'], { category: 'ادارة', description: 'رسالة التكت', execute(message) { if (!isModerator(message.member)) return message.reply('للإدارة فقط!'); const embed = new EmbedBuilder().setColor(0x808080).setTitle('فتح تذكرة').setDescription('اختر نوع التذكرة:\n\n1. تفتح تكت وتستهبل = تايم 10 دقايق\n2. تفتح تكت وما ترد = يتقفل\n3. أسلوبك سيء = تايم 10 دقايق\n4. يرجى فتح تذكرة بسبب واضح').setFooter({ text: 'التذاكر للتواصل مع الإدارة فقط' }).setImage('https://cdn.discordapp.com/attachments/1461825102176849990/1516927147707600967/image.png?ex=6a346bff&is=6a331a7f&hm=c0e4e571aa88a54744e287f363713de0ee8a02922b04103968d6055b1ab5231a'); const selectRow = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('ticket_type').setPlaceholder('اختر نوع التكت').addOptions(new StringSelectMenuOptionBuilder().setLabel('استفسار').setValue('inquiry').setDescription('سؤال عام'), new StringSelectMenuOptionBuilder().setLabel('Open Ticket').setValue('open_ticket').setDescription('تذكرة عامة'), new StringSelectMenuOptionBuilder().setLabel('شكوى على عضو').setValue('member_report').setDescription('شكوى'))); message.channel.send({ embeds: [embed], components: [selectRow] }); } });
  registerCommand('join', ['دخل', 'صوت'], { category: 'عام', description: 'يدخل البوت الروم الصوتي 24/7 مع مايك شغال وميوت مفصول', execute(message) {
    
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply('❌ ادخل روم صوتي الأول!');
    
    try {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
      });
      
      connection.on(VoiceConnectionStatus.Ready, () => {
        message.reply(`✅ دخلت الروم **${voiceChannel.name}** | 🔊 مايك شغال | 🔓 ميوت مفصول | ⏰ 24/7`);
      });
      
      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch (error) {
          connection.destroy();
        }
      });
    } catch (err) {
      message.reply('❌ ما قدرت أدخل الروم! تأكد من صلاحيات البوت');
    }
  } });
  registerCommand('sqmr1', ['تحقق', 'ver'], { category: 'ادارة', description: 'رسالة تحقق', execute(message) { if (!isAdmin(message.member)) return message.reply('للأدمن فقط!'); const embed = new EmbedBuilder().setColor(0x808080).setTitle('تحقق').setDescription('اضغط على الزر عشان نتحقق'); const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify_human').setLabel('تحقق').setStyle(ButtonStyle.Primary)); message.channel.send({ embeds: [embed], components: [row] }); } });
  registerCommand('poll', ['تصويت', 'pl'], { category: 'عام', description: 'تصويت', execute(message, args) { const q = args.join(' '); if (!q) return message.reply('اكتب السؤال!'); message.channel.send({ embeds: [{ color: 0x808080, title: 'تصويت', description: q }] }).then(m => { m.react('👍'); m.react('👎'); }); } });
  registerCommand('giveaway', ['جيف', 'gv'], { category: 'ادارة', description: 'جيف أواي', execute(message, args) { if (!isModerator(message.member)) return message.reply('للإدارة فقط!'); const d = args[0]; const w = parseInt(args[1]); const prize = args.slice(2).join(' '); if (!d || !w || !prize) return message.reply('الاستخدام: !giveaway 1h 1 جوائز'); const ms = d.endsWith('m') ? parseInt(d) * 60000 : d.endsWith('h') ? parseInt(d) * 3600000 : d.endsWith('d') ? parseInt(d) * 86400000 : 3600000; bot.giveawayCounter++; const end = Date.now() + ms; message.channel.send({ embeds: [{ color: 0x808080, title: 'جيف أواي', description: `الجائزة: **${prize}**\nالفائزين: ${w}\nالانتهاء: <t:${Math.floor(end / 1000)}:R>`, footer: { text: `ID: ${bot.giveawayCounter}` } }] }).then(msg => { msg.react('🎉'); bot.giveaways.set(bot.giveawayCounter, { msgId: msg.id, channelId: msg.channel.id, prize, winners: w, endTime: end, participants: [] }); setTimeout(async () => { const g = bot.giveaways.get(bot.giveawayCounter); const c = message.guild.channels.cache.get(g.channelId); const m = await c.messages.fetch(g.msgId); const u = (await m.reactions.cache.get('🎉').users.fetch()).filter(x => !x.bot); const winnersList = u.random(g.winners); c.send(winnersList.length ? `مبروك ${winnersList.join(', ')}! فزتوا بـ: **${prize}**` : 'ما في مشاركين كفاية!'); }, ms); }); } });
  registerCommand('suggest', ['اقتراح', 'sg'], { category: 'عام', description: 'اقتراح', execute(message, args) { const text = args.join(' '); if (!text) return message.reply('اكتب الاقتراح!'); message.channel.send({ embeds: [{ color: 0x808080, title: 'اقتراح جديد', description: text, footer: { text: `بواسطة ${message.author.username}` } }] }).then(m => { m.react('👍'); m.react('👎'); }); message.delete().catch(() => {}); } });
  registerCommand('report', ['ابلاغ', 'rep'], { category: 'عام', description: 'إبلاغ', execute(message, args) { const text = args.join(' '); if (!text) return message.reply('اكتب التقرير!'); message.reply({ embeds: [{ color: 0x808080, title: 'إبلاغ', description: text }] }); } });
  registerCommand('remind', ['تذكير', 'rm'], { category: 'عام', description: 'تذكير', execute(message, args) { const time = args[0]; const text = args.slice(1).join(' '); if (!time || !text) return message.reply('الاستخدام: !remind 10m اجتماع'); const ms = time.endsWith('m') ? parseInt(time) * 60000 : time.endsWith('h') ? parseInt(time) * 3600000 : 60000; message.reply(`تم تعيين تذكير بعد ${time}`); setTimeout(() => message.author.send(`تذكير: ${text}`).catch(() => {}), ms); } });
  registerCommand('help', ['مساعدة', 'h'], { category: 'عام', description: 'قائمة الأوامر', execute(message) { const a = [], m = [], p = [], l = [], s = []; bot.commands.forEach(cmd => { if (cmd.name === 'help') return; const al = cmd.aliases ? ` (${cmd.aliases.join(', ')})` : ''; const line = `\`!${cmd.name}\`${al} - ${cmd.description}`; if (cmd.category === 'ادارة') (['تكت', 'sqmr1', 'announce', 'resetxp', 'unwarn', 'giveaway'].includes(cmd.name) ? a : m).push(line); else if (cmd.category === 'لفل') l.push(line); else if (cmd.category === 'اعدادات') s.push(line); else p.push(line); }); message.reply({ embeds: [{ color: 0x808080, title: 'قائمة الأوامر', fields: [{ name: 'Admin', value: a.join('\n') || 'لا يوجد' }, { name: 'Mod', value: m.join('\n') || 'لا يوجد' }, { name: 'لفل', value: l.join('\n') || 'لا يوجد' }, { name: 'اعدادات', value: s.join('\n') || 'لا يوجد' }, { name: 'عامة', value: p.join('\n') || 'لا يوجد' }], footer: { text: `${bot.commands.size} امر` } }] }); } });
  registerCommand('setwelcome', ['روم-ترحيب', 'sw'], { category: 'اعدادات', description: 'روم الترحيب', execute(message) { if (!isAdmin(message.member)) return message.reply('للأدمن فقط!'); const c = message.mentions.channels.first(); if (!c) return message.reply('منشن الروم!'); bot.welcomeChannels.set(message.guild.id, c.id); const previewEmbed = new EmbedBuilder().setColor(0x808080).setDescription(`منور/ه ${message.author}`).setThumbnail(message.author.displayAvatarURL({ size: 4096 })).addFields({ name: 'الاخبار', value: '<#1502422290896523334>' }, { name: 'تحقق', value: '<#1502440141992755283>' }).setFooter({ text: `عضو رقم ${message.guild.memberCount}` }).setTimestamp(); c.send({ embeds: [previewEmbed] }).then(() => message.reply(`تم تعيين روم الترحيب: ${c}`)).catch(() => message.reply('ما قدرت أرسل في الروم!')); } });
  registerCommand('setticket', ['روم-تكت', 'st'], { category: 'اعدادات', description: 'روم لوق التكت', execute(message) { if (!isAdmin(message.member)) return message.reply('للأدمن فقط!'); const c = message.mentions.channels.first(); if (!c) return message.reply('منشن روم اللوق!'); bot.ticketSettings.set(message.guild.id, { logChannel: c.id }); message.reply(`تم: ${c}`); } });
  registerCommand('setlevel', ['روم-لفل', 'sl'], { category: 'اعدادات', description: 'روم اللفل', execute(message) { if (!isAdmin(message.member)) return message.reply('للأدمن فقط!'); const c = message.mentions.channels.first(); if (!c) return message.reply('منشن الروم!'); bot.levelChannels.set(message.guild.id, c.id); message.reply(`تم: ${c}`); } });
  registerCommand('setlog', ['روم-لوق', 'log'], { category: 'اعدادات', description: 'روم اللوق', execute(message) { if (!isAdmin(message.member)) return message.reply('للأدمن فقط!'); const c = message.mentions.channels.first(); if (!c) return message.reply('منشن روم اللوق!'); bot.logChannels.set(message.guild.id, c.id); message.reply(`تم: ${c}`); } });
}

// ========== EVENTS ==========

function setupEvents() {
  const voiceJoinTimes = new Map();

  bot.on('messageCreate', (message) => {
    if (message.author.bot || !message.guild) return;

    // Ticket message logging
    if (bot.tickets && bot.tickets.has(message.channel.id)) {
      const ticket = bot.tickets.get(message.channel.id);
      if (ticket.status === 'open' && bot.ticketSettings.has(message.guild.id)) {
        const settings = bot.ticketSettings.get(message.guild.id);
        if (settings.logChannel) {
          const logCh = message.guild.channels.cache.get(settings.logChannel);
          if (logCh) {
            const logEmbed = new EmbedBuilder()
              .setColor(0x808080)
              .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
              .setDescription(`**الرسالة:**\n${message.content || 'ملف/صورة'}`)
              .addFields(
                { name: 'العضو', value: `${message.author} | \`${message.author.id}\``, inline: true },
                { name: 'التكت', value: `<#${message.channel.id}>`, inline: true },
                { name: 'الوقت', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
              )
              .setFooter({ text: `تكت #${ticket.ticketNumber || ticket.type}` });
            logCh.send({ embeds: [logEmbed] }).catch(() => {});
          }
        }
      }
    }

    if (message.mentions.roles.size > 0 && message.mentions.members.size > 0) {
      const r = message.mentions.roles.first();
      const m = message.mentions.members.first();
      if (m.id === message.author.id || m.user.bot) return;
      if (r.permissions.has(PermissionFlagsBits.Administrator) || r.permissions.has(PermissionFlagsBits.ManageGuild)) return;
      const me = message.guild.members.me;
      if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply('البوت ما عنده صلاحية!');
      if (r.position >= me.roles.highest.position) return message.reply('الرتبة أعلى من رتبة البوت!');
      m.roles.add(r).then(() => { message.reply(`تم إعطاء ${m.user.username} رتبة ${r.name}`); }).catch(() => message.reply('ما قدرت!'));
      return;
    }

    const noPrefix = { 'ping': 'ping', 'بنق': 'ping', 'p': 'ping', 'say': 'say', 'قل': 'say', 's': 'say', 'userinfo': 'userinfo', 'معلومات': 'userinfo', 'ui': 'userinfo', 'serverinfo': 'serverinfo', 'سيرفر': 'serverinfo', 'si': 'serverinfo', 'avatar': 'avatar', 'صورة': 'avatar', 'av': 'avatar', 'banner': 'banner', 'بانر': 'banner', 'bn': 'banner', 'id': 'id', 'ايدي': 'id', 'i': 'id', 'roles': 'roles', 'رتب': 'roles', 'r': 'roles', 'botinfo': 'botinfo', 'بوت': 'botinfo', 'bi': 'botinfo', 'invite': 'invite', 'دعوة': 'invite', 'inv': 'invite', 'rank': 'rank', 'لفل': 'rank', 'لفلي': 'rank', 'rl': 'rank', 'leaderboard': 'leaderboard', 'ليدر': 'leaderboard', 'توب': 'leaderboard', 'lb': 'leaderboard', 'points': 'points', 'نقاط': 'points', 'نقاطي': 'points', 'pt': 'points', 'clear': 'clear', 'مسح': 'clear', 'حذف': 'clear', 'c': 'clear', 'kick': 'kick', 'طرد': 'kick', 'k': 'kick', 'ban': 'ban', 'قمنقلع': 'ban', 'b': 'ban', 'unban': 'unban', 'فك': 'unban', 'ub': 'unban', 'mute': 'mute', 'اسكت': 'mute', 'unmute': 'unmute', 'تكلم': 'unmute', 'warn': 'warn', 'ت': 'warn', 'w': 'warn', 'warnings': 'warnings', 'تحذيرات': 'warnings', 'ws': 'warnings', 'unwarn': 'unwarn', 'شيل': 'unwarn', 'uw': 'unwarn', 'slowmode': 'slowmode', 'بطيء': 'slowmode', 'sm': 'slowmode', 'lock': 'lock', 'قفل': 'lock', 'ق': 'lock', 'unlock': 'unlock', 'فتح': 'unlock', 'ف': 'unlock', 'nick': 'nick', 'لقب': 'nick', 'n': 'nick', 'role': 'role', 'رتبة': 'role', 'rol': 'role', 'announce': 'announce', 'اعلان': 'announce', 'ann': 'announce', 'تكت': 'تكت', 'تذكرة': 'تكت', 'tk': 'تكت', 'setwelcome': 'setwelcome', 'روم-ترحيب': 'setwelcome', 'sw': 'setwelcome', 'setticket': 'setticket', 'روم-تكت': 'setticket', 'st': 'setticket', 'setlevel': 'setlevel', 'روم-لفل': 'setlevel', 'sl': 'setlevel', 'setlog': 'setlog', 'روم-لوق': 'setlog', 'log': 'setlog', 'sqmr1': 'sqmr1', 'تحقق': 'sqmr1', 'ver': 'sqmr1', 'poll': 'poll', 'تصويت': 'poll', 'pl': 'poll', 'giveaway': 'giveaway', 'جيف': 'giveaway', 'gv': 'giveaway', 'suggest': 'suggest', 'اقتراح': 'suggest', 'sg': 'suggest', 'report': 'report', 'ابلاغ': 'report', 'rep': 'report', 'remind': 'remind', 'تذكير': 'remind', 'rm': 'remind', 'help': 'help', 'مساعدة': 'help', 'h': 'help', 'addxp': 'addxp', 'اضافة-لفل': 'addxp', 'axp': 'addxp', 'resetxp': 'resetxp', 'تصفير-لفل': 'resetxp', 'rxp': 'resetxp', 'embed': 'embed', 'ايمبد': 'embed', 'em': 'embed', 'join': 'join', 'دخل': 'join', 'صوت': 'join' };

    const content = message.content.trim().toLowerCase();
    if (!message.content.startsWith('!') && noPrefix[content]) {
      const cmd = bot.commands.get(noPrefix[content]);
      if (cmd) { try { cmd.execute(message, []); return; } catch { return message.reply('صار خطأ!'); } }
    }

    const xpGain = Math.floor(Math.random() * 10) + 5;
    const result = addXP(message.author.id, message.guild.id, xpGain);
    addPoints(message.author.id, message.guild.id, Math.floor(xpGain / 2));

    if (result.leveledUp && bot.levelChannels.has(message.guild.id)) {
      const ch = message.guild.channels.cache.get(bot.levelChannels.get(message.guild.id));
      if (ch) ch.send({ embeds: [{ color: 0x808080, title: 'لفل جديد!', description: `مبروك ${message.author}! وصلت للفل **${result.newLevel}**` }] });
    }

    if (result.leveledUp) {
      message.author.send({ embeds: [{ color: 0x808080, title: 'مبروك!', description: `وصلت للفل **${result.newLevel}** في **${message.guild.name}**!` }] }).catch(() => {});
    }

    if (!message.content.startsWith('!')) return;
    const args = message.content.slice(1).trim().split(/ +/);
    let cmdName = args.shift().toLowerCase();
    if (bot.aliases.has(cmdName)) cmdName = bot.aliases.get(cmdName);
    const cmd = bot.commands.get(cmdName);
    if (!cmd) return;
    try { cmd.execute(message, args); } catch { message.reply('صار خطأ!'); }
  });

  bot.on('messageDelete', async (message) => {
    if (message.author?.bot || !message.guild) return;
    // log
  });

  bot.on('guildMemberAdd', (member) => {
    if (bot.welcomeChannels.has(member.guild.id)) {
      const ch = member.guild.channels.cache.get(bot.welcomeChannels.get(member.guild.id));
      if (ch) {
        const avatarUrl = member.user.displayAvatarURL({ size: 4096 });
        const welcomeEmbed = new EmbedBuilder()
          .setColor(0x808080)
          .setAuthor({ name: member.user.tag, iconURL: avatarUrl })
          .setDescription(`منور/ه ${member}`)
          .addFields(
            { name: 'الاخبار', value: '<#1477426333779886202>' }
          )
          .setImage(avatarUrl)
          .setFooter({ text: `عضو رقم ${member.guild.memberCount}` })
          .setTimestamp();
        ch.send({ embeds: [welcomeEmbed] });
      }
    }
  });

  bot.on('guildMemberRemove', () => {});

  bot.on('voiceStateUpdate', (oldState, newState) => {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot) return;
    if (!oldState.channelId && newState.channelId) {
      voiceJoinTimes.set(`${member.guild.id}-${member.id}`, Date.now());
    }
    if (oldState.channelId && !newState.channelId) {
      const joinTime = voiceJoinTimes.get(`${member.guild.id}-${member.id}`);
      const duration = joinTime ? Math.floor((Date.now() - joinTime) / 1000) : null;
      voiceJoinTimes.delete(`${member.guild.id}-${member.id}`);
      const key = `${member.guild.id}-${member.id}`;
      if (bot.levels.has(key)) { bot.levels.get(key).voiceTime += duration || 0; }
    }
  });

  bot.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isStringSelectMenu()) return;

    if (interaction.customId === 'verify_human') {
      const member = interaction.member;
      const roleId = '1502800437235945692';
      if (member.roles.cache.has(roleId)) return interaction.reply({ content: 'تم التحقق مسبقاً!', ephemeral: true });
      await member.roles.add(roleId).catch(() => interaction.reply({ content: 'ما قدرت أعطيك الرتبة!', ephemeral: true }));
      await interaction.reply({ content: `تم التحقق! تم إعطاؤك رتبة <@&${roleId}>`, ephemeral: true });
    }

    if (interaction.customId === 'ticket_type') {
      const existing = Array.from(bot.tickets.values()).find(t => t.userId === interaction.user.id && t.status === 'open');
      if (existing) return interaction.reply({ content: `عندك تكت مفتوح: <#${existing.channelId}>`, ephemeral: true });
      const typeMap = { 'inquiry': 'استفسار', 'open_ticket': 'Open Ticket', 'member_report': 'شكوى-عضو' };
      const type = interaction.values[0];
      bot.ticketCounter++;
      const channel = await interaction.guild.channels.create({ name: `${typeMap[type]}-${bot.ticketCounter}`, type: 0, permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }] });
      const data = { userId: interaction.user.id, channelId: channel.id, status: 'open', type: typeMap[type], createdAt: new Date(), closedAt: null, closedBy: null, closeReason: null, duration: null, claimedBy: null, ticketNumber: bot.ticketCounter };
      bot.tickets.set(channel.id, data);
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('claim_ticket').setLabel('استلام').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('rename_ticket').setLabel('تغيير الاسم').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('close_ticket').setLabel('اغلاق').setStyle(ButtonStyle.Danger));
      const embed = new EmbedBuilder().setColor(0x808080).setTitle(`تكت ${typeMap[type]}`).setDescription(`مرحبا ${interaction.user}\nالنوع: ${typeMap[type]}\nرقم: ${bot.ticketCounter}`).setFooter({ text: `تكت رقم ${bot.ticketCounter}` });
      await channel.send({ embeds: [embed], components: [row] });
      await interaction.reply({ content: `تم فتح تكت: ${channel}`, ephemeral: true });
      // Send log to ticket log channel
      const ticketLogSettings = bot.ticketSettings.get(interaction.guild.id);
      if (ticketLogSettings && ticketLogSettings.logChannel) {
        const logCh = interaction.guild.channels.cache.get(ticketLogSettings.logChannel);
        if (logCh) {
          const logEmbed = new EmbedBuilder().setColor(0x808080).setTitle('🎫 تكت مفتوح').setDescription(`**العضو:** ${interaction.user}\n**النوع:** ${typeMap[type]}\n**الرقم:** ${bot.ticketCounter}\n**الروم:** ${channel}\n**الوقت:** <t:${Math.floor(Date.now() / 1000)}:F>`).setTimestamp();
          logCh.send({ embeds: [logEmbed] }).catch(() => {});
        }
      }
    }

    if (interaction.customId === 'claim_ticket') {
      const ticket = bot.tickets.get(interaction.channel.id);
      if (!ticket || ticket.status !== 'open') return;
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: 'للإدارة فقط!', ephemeral: true });
      ticket.claimedBy = interaction.user.id;
      bot.tickets.set(interaction.channel.id, ticket);
      await interaction.channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
      await interaction.reply({ embeds: [{ color: 0x808080, description: `تم الاستلام: ${interaction.user}` }] });
      // Log claim
      const settings = bot.ticketSettings.get(interaction.guild.id);
      if (settings && settings.logChannel) {
        const logCh = interaction.guild.channels.cache.get(settings.logChannel);
        if (logCh) {
          const logEmbed = new EmbedBuilder().setColor(0x808080).setTitle('👤 استلام تكت').setDescription(`**التكت:** <#${interaction.channel.id}>\n**الاداري:** ${interaction.user}\n**الوقت:** <t:${Math.floor(Date.now() / 1000)}:R>`).setTimestamp();
          logCh.send({ embeds: [logEmbed] }).catch(() => {});
        }
      }
    }

    if (interaction.customId === 'rename_ticket') {
      const ticket = bot.tickets.get(interaction.channel.id);
      if (!ticket || ticket.status !== 'open') return;
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: 'للإدارة فقط!', ephemeral: true });
      const modal = new ModalBuilder().setCustomId('rename_modal').setTitle('تغيير اسم').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('new_name').setLabel('الاسم').setStyle(TextInputStyle.Short).setPlaceholder('تكت-مساعدة').setRequired(true).setMaxLength(100)));
      await interaction.showModal(modal);
    }

    if (interaction.customId === 'close_ticket') {
      const ticket = bot.tickets.get(interaction.channel.id);
      if (!ticket || ticket.status !== 'open') return;
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) return interaction.reply({ content: 'للإدارة فقط!', ephemeral: true });
      const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('close_reason').setPlaceholder('سبب الاغلاق').addOptions(new StringSelectMenuOptionBuilder().setLabel('تم الحل').setValue('solved'), new StringSelectMenuOptionBuilder().setLabel('مخالفة').setValue('violation'), new StringSelectMenuOptionBuilder().setLabel('تكرار').setValue('spam'), new StringSelectMenuOptionBuilder().setLabel('غير نشط').setValue('inactive'), new StringSelectMenuOptionBuilder().setLabel('سبب اخر').setValue('other')));
      await interaction.reply({ embeds: [{ color: 0x808080, title: 'اغلاق التكت', description: 'اختر سبب:' }], components: [row] });
    }

    if (interaction.customId === 'close_reason') {
      const ticket = bot.tickets.get(interaction.channel.id);
      if (!ticket || ticket.status !== 'open') return;
      const reasonMap = { 'solved': 'تم الحل', 'violation': 'مخالفة', 'spam': 'تكرار', 'inactive': 'غير نشط', 'other': 'سبب اخر' };
      const closeReason = reasonMap[interaction.values[0]];
      const closeTime = new Date();
      const duration = Math.floor((closeTime - ticket.createdAt) / 1000 / 60);
      ticket.status = 'closed'; ticket.closedAt = closeTime; ticket.closedBy = interaction.user.id; ticket.closeReason = closeReason; ticket.duration = duration;
      bot.tickets.set(interaction.channel.id, ticket);
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('confirm_close').setLabel('نعم، اغلق').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('cancel_close').setLabel('لا').setStyle(ButtonStyle.Secondary));
      await interaction.update({ embeds: [{ color: 0x808080, title: 'تأكيد الاغلاق', description: `**العضو:** <@${ticket.userId}>\n**المدة:** ${duration} دقيقة\n**السبب:** ${closeReason}\n**الوقت:** <t:${Math.floor(Date.now() / 1000)}:R>` }], components: [row] });
    }

    if (interaction.customId === 'confirm_close') {
      const ticket = bot.tickets.get(interaction.channel.id);
      if (!ticket) return;
      // Send detailed log before deleting
      const ticketLogSettings = bot.ticketSettings.get(interaction.guild.id);
      if (ticketLogSettings && ticketLogSettings.logChannel) {
        const logCh = interaction.guild.channels.cache.get(ticketLogSettings.logChannel);
        if (logCh) {
          const logEmbed = new EmbedBuilder().setColor(0x808080).setTitle('🔒 تكت مغلق').setDescription(`**العضو:** <@${ticket.userId}>\n**النوع:** ${ticket.type}\n**الرقم:** ${ticket.ticketNumber || '?'}\n**السبب:** ${ticket.closeReason || 'غير محدد'}\n**أغلقه:** <@${ticket.closedBy}>\n**المدة:** ${ticket.duration || 0} دقيقة\n**فتح:** <t:${Math.floor(ticket.createdAt / 1000)}:F>\n**قفل:** <t:${Math.floor(Date.now() / 1000)}:F>`).setTimestamp();
          logCh.send({ embeds: [logEmbed] }).catch(() => {});
        }
      }
      await interaction.channel.delete().catch(() => interaction.reply({ content: 'ما قدرت!', ephemeral: true }));
    }

    if (interaction.customId === 'cancel_close') {
      const ticket = bot.tickets.get(interaction.channel.id);
      if (!ticket) return;
      ticket.status = 'open'; ticket.closedAt = null; ticket.closedBy = null; ticket.closeReason = null; ticket.duration = null;
      bot.tickets.set(interaction.channel.id, ticket);
      await interaction.update({ embeds: [{ color: 0x808080, title: 'تم الإلغاء', description: 'التكت مفتوح' }], components: [] });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'rename_modal') {
      const newName = interaction.fields.getTextInputValue('new_name');
      await interaction.channel.setName(newName).catch(() => {});
      await interaction.reply({ content: `تم: ${newName}`, ephemeral: true });
      // Log rename
      const settings = bot.ticketSettings.get(interaction.guild.id);
      if (settings && settings.logChannel) {
        const logCh = interaction.guild.channels.cache.get(settings.logChannel);
        if (logCh) {
          const logEmbed = new EmbedBuilder().setColor(0x808080).setTitle('✏️ تغيير اسم تكت').setDescription(`**التكت:** <#${interaction.channel.id}>\n**الاسم الجديد:** ${newName}\n**الاداري:** ${interaction.user}\n**الوقت:** <t:${Math.floor(Date.now() / 1000)}:R>`).setTimestamp();
          logCh.send({ embeds: [logEmbed] }).catch(() => {});
        }
      }
    }
  });

  bot.on('ready', () => {
    addLog(`✅ ${bot.user.tag} شغال!`);
    addLog(`📊 ${bot.guilds.cache.size} سيرفر | ${bot.users.cache.size} مستخدم`);
  });
}

// ========== API ==========

app.post('/api/start', async (req, res) => {
  const { token } = req.body;
  if (bot) return res.json({ success: false, error: 'البوت شغال!' });
  if (!token || token.length < 50) return res.json({ success: false, error: 'توكن غلط!' });
  botToken = token;
  try {
    bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildModeration] });
    bot.commands = new Collection();
    bot.aliases = new Map();
    bot.tickets = new Map();
    bot.levels = new Map();
    bot.points = new Map();
    bot.warnings = new Map();
    bot.welcomeChannels = new Map();
    bot.ticketSettings = new Map();
    bot.levelChannels = new Map();
    bot.giveaways = new Map();
    bot.logChannels = new Map();
    bot.ticketCounter = 0;
    bot.giveawayCounter = 0;
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
  res.json({ status: botStatus, tag: bot?.user?.tag || null, guilds: bot?.guilds?.cache?.size || 0, users: bot?.users?.cache?.size || 0, ping: bot?.ws?.ping || 0 });
});

app.get('/api/logs', (req, res) => res.json(logs));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Dashboard: http://localhost:${PORT}`));
