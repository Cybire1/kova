package xyz.kova.tap

import android.content.ComponentName
import android.content.pm.PackageManager
import android.nfc.NfcAdapter
import android.nfc.cardemulation.CardEmulation
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Tap a phone to pay: the till offers its charge's pay link over NFC (KovaTagService) while the
 * charge is on screen, and tells the app when a phone has read it.
 */
class KovaTapModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KovaTap")
    Events("onRead")

    OnCreate {
      KovaTagService.onRead = { sendEvent("onRead", emptyMap<String, Any>()) }
    }

    OnDestroy {
      KovaTagService.onRead = null
      KovaTagService.ndefFile = null
    }

    /** Whether this phone can answer taps (it has NFC with host card emulation, switched on). */
    Function("isSupported") {
      val context = appContext.reactContext ?: return@Function false
      val adapter = NfcAdapter.getDefaultAdapter(context) ?: return@Function false
      context.packageManager.hasSystemFeature(PackageManager.FEATURE_NFC_HOST_CARD_EMULATION) && adapter.isEnabled
    }

    /** Offers `url` to the next phone that taps, or stops offering anything (null). */
    Function("setLink") { url: String? ->
      KovaTagService.ndefFile = url?.let { KovaTagService.fileFor(it) }
      prefer(url != null)
    }
  }

  /** While a charge is up, Kova answers tag reads ahead of any other app that also could. */
  private fun prefer(on: Boolean) {
    val activity = appContext.currentActivity ?: return
    val adapter = NfcAdapter.getDefaultAdapter(activity) ?: return
    activity.runOnUiThread {
      try {
        val emulation = CardEmulation.getInstance(adapter)
        if (on) emulation.setPreferredService(activity, ComponentName(activity, KovaTagService::class.java))
        else emulation.unsetPreferredService(activity)
      } catch (_: Exception) {
        // Not preferred: Android still routes the tag AID to Kova unless another app claims it too.
      }
    }
  }
}
