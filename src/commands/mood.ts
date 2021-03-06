import { SlashCommandBuilder } from '@discordjs/builders'
import dayjs from 'dayjs'
import { MessageActionRow, MessageSelectMenu, MessageSelectOptionData } from 'discord.js'
import { recordModel } from '../database/models/record'
import { getUser } from '../database/models/user'
import { Command } from '../interfaces/command'
import { ONE_EMOJI, TWO_EMOJI, THREE_EMOJI, FOUR_EMOJI, FIVE_EMOJI } from '../interfaces/emojis'
import { jobs } from '../jobs/scheduleReminderJob'
import { alternateJoin } from '../utils/alternate-join'
import { shuffle } from '../utils/shuffle-array'

const moodRate = new Map<string, number>()

moodRate.set(ONE_EMOJI, 1)
moodRate.set(TWO_EMOJI, 2)
moodRate.set(THREE_EMOJI, 3)
moodRate.set(FOUR_EMOJI, 4)
moodRate.set(FIVE_EMOJI, 5)

const getEmotionOptions = () => {
  const emotions = shuffle(['antusias', 'gembira', 'takjub', 'semangat', 'bangga', 'penuh cinta', 'santai', 'tenang', 'puas',
    'marah', 'takut', 'stress', 'waspada', 'kesal', 'malu', 'cemas', 'lesu', 'sedih', 'duka', 'bosan', 'kesepian', 'bingung'])
  const emotionOptions : MessageSelectOptionData[] = []
  for (const emotion of emotions) {
    emotionOptions.push({ label: emotion, value: emotion })
  }
  return emotionOptions
}

const getEmotionSourceOptions = () => {
  const emotionSource = shuffle(['keluarga', 'pekerjaan', 'teman', 'percintaan', 'kesehatan', 'pendidikan', 'tidur', 'perjalanan', 'bersantai', 'makanan',
    'olahraga', 'hobi', 'cuaca', 'belanja', 'hiburan', 'keuangan', 'ibadah'])

  const emotionSourceOptions: MessageSelectOptionData[] = []

  for (const emotion of emotionSource) {
    emotionSourceOptions.push({ label: emotion, value: emotion })
  }

  return emotionSourceOptions
}

export const mood: Command = {
  data: new SlashCommandBuilder()
    .setName('mood')
    .setDescription('Record your moood for the day'),
  async run (interaction) {
    const reply = await interaction.reply({ content: 'Rate your mood today!', fetchReply: true })
    const message = await interaction.channel?.messages.fetch(reply.id)

    if (!message) return

    for (const reaction of moodRate.keys()) {
      await message.react(reaction)
    }

    try {
      const reactions = await message.awaitReactions({
        max: 1,
        filter: (reaction, user) => {
          return !!reaction.emoji.name && moodRate.has(reaction.emoji.name) && interaction.user.id === user.id
        },
        time: 20_000
      })

      if (reactions.size === 0) {
        throw Error('No reactions collected')
      }

      const rate = moodRate.get(reactions.first()?.emoji.name!)

      await message.edit(`Rate mood anda adalah ${rate}`)
      await message.reactions.removeAll()

      const emotionRow = new MessageActionRow().addComponents(
        new MessageSelectMenu()
          .setCustomId('emotion')
          .setPlaceholder('Nothing selected')
          .setMinValues(1)
          .setMaxValues(5)
          .addOptions(getEmotionOptions())
      )

      const messageEmotion = await interaction.channel?.messages.fetch((
        await interaction.followUp({
          content: 'Emosi apa saja yang sedang kamu rasakan?',
          components: [emotionRow],
          fetchReply: true
        })).id)

      const emotions = await messageEmotion?.awaitMessageComponent({
        filter: (i) => {
          i.deferUpdate()
          return i.user.id === interaction.user.id
        },
        componentType: 'SELECT_MENU',
        time: 30_000
      })

      await messageEmotion?.edit({ content: `Emosi anda adalah ${alternateJoin(emotions?.values)}`, components: [] })

      const emotionSourceRow = new MessageActionRow().addComponents(
        new MessageSelectMenu()
          .setCustomId('emotion-cause')
          .setPlaceholder('Nothing selected')
          .setMinValues(1)
          .setMaxValues(5)
          .addOptions(getEmotionSourceOptions())
      )

      const messageEmotionSource = await interaction.channel?.messages.fetch(
        (
          await interaction.followUp({
            content: 'Dari mana datangnya emosi tersebut?',
            components: [emotionSourceRow],
            fetchReply: true
          })
        ).id
      )

      const emotionSources = await messageEmotionSource?.awaitMessageComponent({
        filter: (i) => {
          i.deferUpdate()
          return i.user.id === interaction.user.id
        },
        componentType: 'SELECT_MENU',
        time: 30_000
      })

      await messageEmotionSource?.edit({ content: `Sumber emosi anda adalah ${alternateJoin(emotionSources?.values)}`, components: [] })

      const user = await getUser(interaction.user.id)

      const currentRecord = await recordModel.findOne({
        createdAt: {
          $gte: dayjs().hour(0).minute(0).second(0).millisecond(0).toDate(),
          $lte: dayjs().hour(0).minute(0).second(0).millisecond(0).add(1, 'day').toDate()
        },
        discordId: user.discordId
      }).exec()

      if (currentRecord) {
        currentRecord.discordId = user.discordId
        currentRecord.emotion = emotions?.values!
        currentRecord.emotionSource = emotionSources?.values!
        currentRecord.moodLevel = rate!
        await currentRecord.save()
        await interaction.followUp('Ada telah mengisi catatan hari ini sehingga catatan lama akan diperbarui.')
      } else {
        await recordModel.create({
          discordId: user.discordId,
          emotion: emotions?.values,
          emotionSource: emotionSources?.values,
          moodLevel: rate
        })
        await interaction.followUp('Mood berhasil tercatat!')
      }

      if (user.reminder) {
        if (jobs.has(user.discordId)) {
          jobs.get(user.discordId)?.stop()
        }
      }
    } catch (error) {
      await interaction.followUp('Input gagal karena batas waktu untuk menjawab telah berakhir')
    }
  }
}
