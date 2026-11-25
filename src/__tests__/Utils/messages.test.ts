import { proto } from '../../../WAProto/index.js'
import type { ILogger } from '../../Utils/logger'
import { generateWAMessageContent, getContentType, normalizeMessageContent } from '../../Utils/messages'

const createLogger = (): ILogger => {
	const logger: ILogger = {
		level: 'silent',
		child: () => logger,
		trace: () => {},
		debug: () => {},
		info: () => {},
		warn: () => {},
		error: () => {}
	}
	return logger
}

// the media bytes are opaque to the send path: encryption just encrypts them and
// the upload is mocked, so tiny stand-in buffers are enough to test the structure
const stickerBytes = Buffer.from('fake-webp-bytes')
const audioBytes = Buffer.from('fake-opus-bytes')

describe('sound stickers', () => {
	it('builds a sound sticker message matching the sampled wire format', async () => {
		const uploadCalls: string[] = []
		const upload = async (_encFilePath: string, opts: { mediaType: string }) => {
			uploadCalls.push(opts.mediaType)
			return { mediaUrl: 'https://mmg.whatsapp.net/test', directPath: '/test-path' }
		}

		const content = await generateWAMessageContent(
			{
				soundSticker: { sticker: stickerBytes, audio: audioBytes },
				isAnimated: true,
				seconds: 5,
				width: 512,
				height: 512
			},
			{ upload, logger: createLogger() }
		)

		const sticker = content.soundStickerMessage?.message?.stickerMessage
		expect(sticker).toBeDefined()
		// field 24: present (value 0) in every sticker sample
		expect(sticker!.stickerFlags).toBe(0)
		// the audio track is a complete AudioMessage attached to the sticker
		expect(sticker!.audioMessage).toBeDefined()
		expect(sticker!.audioMessage!.mimetype).toBe('audio/ogg; codecs=opus')
		expect(sticker!.audioMessage!.seconds).toBe(5)
		expect(sticker!.audioMessage!.ptt).toBeFalsy()
		// field 74 in each media's contextInfo references that media's own mediaKey
		expect(sticker!.contextInfo?.mediaKeyInfo?.version).toBe(1)
		expect(sticker!.contextInfo?.mediaKeyInfo?.mediaKey).toEqual(sticker!.mediaKey)
		expect(sticker!.audioMessage!.contextInfo?.mediaKeyInfo?.version).toBe(1)
		expect(sticker!.audioMessage!.contextInfo?.mediaKeyInfo?.mediaKey).toEqual(sticker!.audioMessage!.mediaKey)
		expect(uploadCalls).toEqual(['sticker', 'audio'])

		// the built message survives an encode/decode round-trip with all new fields
		const bytes = proto.Message.encode(content).finish()
		const decoded = proto.Message.decode(bytes)
		expect(decoded.soundStickerMessage?.message?.stickerMessage?.audioMessage).toBeDefined()
		expect(decoded.soundStickerMessage?.message?.stickerMessage?.stickerFlags).toBe(0)
	})

	it('unwraps an incoming sound sticker to the sticker message', () => {
		const incoming = proto.Message.create({
			soundStickerMessage: {
				message: {
					stickerMessage: {
						url: 'https://mmg.whatsapp.net/sticker',
						audioMessage: { mimetype: 'audio/ogg; codecs=opus', seconds: 5 }
					}
				}
			}
		})

		const inner = normalizeMessageContent(incoming)
		expect(getContentType(inner)).toBe('stickerMessage')
		expect(inner?.stickerMessage?.audioMessage).toBeDefined()
	})
})
