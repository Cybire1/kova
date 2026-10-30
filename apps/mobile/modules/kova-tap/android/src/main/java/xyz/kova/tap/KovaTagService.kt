package xyz.kova.tap

import android.nfc.cardemulation.HostApduService
import android.os.Bundle

/**
 * The till phone answering a tap as an NFC Forum Type 4 Tag whose one NDEF record is the charge's
 * pay link (https://mykova.app/pay/…). A customer's phone reads it like a sticker: an iPhone opens
 * the link from the lock screen, an Android phone dispatches it, and either opens Kova (or the web
 * pay page) on that exact payment, to approve with Face ID or a fingerprint. The tag only carries
 * the request; nothing moves until the customer approves on their own phone.
 *
 * Only while a charge is on screen: with no link set, it answers "not found" and stays invisible.
 */
class KovaTagService : HostApduService() {
  companion object {
    /** The NDEF file: a two-byte length, then the message. Null when no charge is offered. */
    @Volatile var ndefFile: ByteArray? = null

    /** Called once a reader has read the whole link. */
    @Volatile var onRead: (() -> Unit)? = null

    private val OK = byteArrayOf(0x90.toByte(), 0x00)
    private val NOT_FOUND = byteArrayOf(0x6A.toByte(), 0x82.toByte())
    private val WRONG_OFFSET = byteArrayOf(0x6B.toByte(), 0x00)
    private val UNKNOWN = byteArrayOf(0x6D.toByte(), 0x00)

    private val SELECT_APP = byteArrayOf(
      0x00, 0xA4.toByte(), 0x04, 0x00, 0x07,
      0xD2.toByte(), 0x76, 0x00, 0x00, 0x85.toByte(), 0x01, 0x01,
    )

    /** Capability Container: mapping 2.0, reads of up to 59 bytes, the NDEF file E104, read-only. */
    private val CC = byteArrayOf(
      0x00, 0x0F, 0x20, 0x00, 0x3B, 0x00, 0x34,
      0x04, 0x06, 0xE1.toByte(), 0x04, 0x04, 0x00, 0x00, 0xFF.toByte(),
    )

    /** An NDEF file holding one URI record for `url`. */
    fun fileFor(url: String): ByteArray {
      val (prefix, rest) = when {
        url.startsWith("https://www.") -> 0x02 to url.removePrefix("https://www.")
        url.startsWith("https://") -> 0x04 to url.removePrefix("https://")
        else -> 0x00 to url
      }
      val payload = byteArrayOf(prefix.toByte()) + rest.toByteArray(Charsets.UTF_8)
      require(payload.size <= 255) { "Link too long for a short NDEF record" }
      // MB | ME | SR, TNF well-known; type "U".
      val record = byteArrayOf(0xD1.toByte(), 0x01, payload.size.toByte(), 0x55) + payload
      return byteArrayOf((record.size shr 8).toByte(), record.size.toByte()) + record
    }
  }

  private var appSelected = false
  private var file: ByteArray? = null

  override fun processCommandApdu(apdu: ByteArray, extras: Bundle?): ByteArray {
    val ndef = ndefFile ?: return NOT_FOUND
    if (apdu.size >= SELECT_APP.size && apdu.copyOfRange(0, SELECT_APP.size).contentEquals(SELECT_APP)) {
      appSelected = true
      file = null
      return OK
    }
    if (!appSelected || apdu.size < 4 || apdu[0] != 0x00.toByte()) return UNKNOWN
    val ins = apdu[1]
    if (ins == 0xA4.toByte() && apdu[2] == 0x00.toByte() && apdu[3] == 0x0C.toByte() && apdu.size >= 7) {
      val id = ((apdu[5].toInt() and 0xFF) shl 8) or (apdu[6].toInt() and 0xFF)
      file = when (id) {
        0xE103 -> CC
        0xE104 -> ndef
        else -> return NOT_FOUND
      }
      return OK
    }
    if (ins == 0xB0.toByte()) {
      val data = file ?: return NOT_FOUND
      val offset = ((apdu[2].toInt() and 0xFF) shl 8) or (apdu[3].toInt() and 0xFF)
      val wanted = if (apdu.size > 4) (apdu[4].toInt() and 0xFF).let { if (it == 0) 256 else it } else 256
      if (offset > data.size) return WRONG_OFFSET
      val end = minOf(data.size, offset + wanted)
      if (data === ndef && end == data.size) onRead?.invoke()
      return data.copyOfRange(offset, end) + OK
    }
    return UNKNOWN
  }

  override fun onDeactivated(reason: Int) {
    appSelected = false
    file = null
  }
}
