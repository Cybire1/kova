import { useEffect, useState } from 'react'
import { Composition, continueRender, delayRender, registerRoot } from 'remotion'
import { FPS } from '../motion'
import { fontsReady } from '../theme'
import { End, END_DURATION } from './End'
import { Receipt, RECEIPT_DURATION } from './Receipt'

function Fonts({ children }: { children: React.ReactNode }) {
  const [handle] = useState(() => delayRender('Local fonts'))
  useEffect(() => {
    fontsReady.then(() => continueRender(handle))
  }, [handle])
  return <>{children}</>
}

function Video() {
  const [handle] = useState(() => delayRender('Local fonts'))
  useEffect(() => {
    fontsReady.then(() => continueRender(handle))
  }, [handle])
  return <End />
}

const ReceiptVideo = () => (
  <Fonts>
    <Receipt />
  </Fonts>
)

registerRoot(() => (
  <>
    <Composition id="UltraEnd" component={Video} durationInFrames={Math.round(END_DURATION * FPS)} fps={FPS} width={1080} height={1080} />
    <Composition id="UltraReceipt" component={ReceiptVideo} durationInFrames={Math.round(RECEIPT_DURATION * FPS)} fps={FPS} width={1080} height={1080} />
  </>
))
