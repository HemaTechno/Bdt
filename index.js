const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const admin = require('firebase-admin');
const express = require('express');
require('dotenv').config(); // عشان يقرا التوكن من ملف الـ env

// 1. تشغيل سيرفر بسيط عشان الاستضافة المجانية
const app = express();
app.get('/', (req, res) => res.send('Bot is active and running!'));
app.listen(3000, () => console.log('Web server is ready.'));

// 2. قراءة ملف فايربيس مباشرة من المجلد
const serviceAccount = require('./firebase-service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers] 
});

// 3. التوكن من الـ env، والباقي من الكود مباشرة
const BOT_TOKEN = process.env.BOT_TOKEN; 
const BOOSTLINK_API_KEY = 'حط_مفتاح_الـAPI_بتاع_Boostlink_هنا';
const BOOSTLINK_LINK_ID = 'حط_ايدي_الرابط_هنا';
const ROLE_ID = 'حط_ايدي_الرتبة_هنا';
const GUILD_ID = 'حط_ايدي_السيرفر_هنا';

client.once('ready', () => {
    console.log(`Bot is logged in as ${client.user.tag}`);
    checkExpiredRoles(); 
});

// إرسال رسالة التفعيل
client.on('messageCreate', async message => {
    if (message.content === '!setup' && message.member.permissions.has('Administrator')) {
        const embed = new EmbedBuilder()
            .setTitle('نظام التحقق وتخطي الرابط')
            .setDescription('عشان تاخد رتبة الكتابة لمدة 24 ساعة، اضغط على "إنشاء رابط" وتخطى الإعلان، وبعدين اضغط "تحقق من الإكمال".')
            .setColor('#0099ff');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('generate_link')
                .setLabel('🔗 إنشاء رابط')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('verify_link')
                .setLabel('✅ تحقق من الإكمال')
                .setStyle(ButtonStyle.Success)
        );

        await message.channel.send({ embeds: [embed], components: [row] });
    }
});

// التعامل مع الأزرار
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const clickId = interaction.user.id;

    if (interaction.customId === 'generate_link') {
        try {
            const response = await axios.post(`https://boosty.link/api/links/${BOOSTLINK_LINK_ID}/redirect`, {
                click_id: clickId
            }, {
                headers: { 'Authorization': `Bearer ${BOOSTLINK_API_KEY}` }
            });

            // بناءً على توثيق الموقع، الرابط بيكون في data.url
            const generatedUrl = response.data.data.url; 
            
            await interaction.reply({ 
                content: `**تفضل رابط التخطي الخاص بك (صالح لمدة 15 دقيقة):**\n${generatedUrl}`, 
                ephemeral: true 
            });
        } catch (error) {
            console.error(error.response?.data || error.message);
            await interaction.reply({ content: 'حدث خطأ أثناء توليد الرابط. تأكد من البيانات المدخلة.', ephemeral: true });
        }
    }

    if (interaction.customId === 'verify_link') {
        try {
            const checkRes = await axios.get(`https://boosty.link/api/completions/${clickId}?link_id=${BOOSTLINK_LINK_ID}`, {
                headers: { 'Authorization': `Bearer ${BOOSTLINK_API_KEY}` }
            });

            if (checkRes.data.status === 'completed') {
                const consumeRes = await axios.post(`https://boosty.link/api/completions/${clickId}/consume?link_id=${BOOSTLINK_LINK_ID}`, {}, {
                    headers: { 'Authorization': `Bearer ${BOOSTLINK_API_KEY}` }
                });

                if (consumeRes.data.fully_consumed) {
                    const member = await interaction.guild.members.fetch(interaction.user.id);
                    await member.roles.add(ROLE_ID);

                    const expiresAt = Date.now() + (24 * 60 * 60 * 1000);
                    await db.collection('temporary_roles').doc(interaction.user.id).set({
                        expiresAt: expiresAt
                    });

                    await interaction.reply({ content: '✅ تم التحقق بنجاح! تم إعطاؤك الرتبة لمدة 24 ساعة.', ephemeral: true });
                }
            } else {
                await interaction.reply({ content: '❌ لم تقم بتخطي الرابط بشكل كامل بعد، أو أن الرابط انتهت صلاحيته.', ephemeral: true });
            }
        } catch (error) {
            console.error(error.response?.data || error.message);
            await interaction.reply({ content: 'حدث خطأ أثناء التحقق. جرب مرة تانية.', ephemeral: true });
        }
    }
});

// سحب الرتبة بعد 24 ساعة
function checkExpiredRoles() {
    setInterval(async () => {
        const now = Date.now();
        const snapshot = await db.collection('temporary_roles').where('expiresAt', '<=', now).get();

        if (snapshot.empty) return;

        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return;

        snapshot.forEach(async doc => {
            const userId = doc.id;
            try {
                const member = await guild.members.fetch(userId).catch(() => null);
                if (member) {
                    await member.roles.remove(ROLE_ID);
                }
                await db.collection('temporary_roles').doc(userId).delete();
            } catch (err) {
                console.error(`Failed to remove role for ${userId}`, err);
            }
        });
    }, 5 * 60 * 1000); 
}

client.login(BOT_TOKEN);
