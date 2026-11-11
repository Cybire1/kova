/** Its own entry, so the film's Root (tracked in git) stays as submitted. */
import { Composition, registerRoot } from 'remotion'
import { FPS } from '../motion'
import { DEMO_DURATION, KovaPhoneDemo } from './KovaPhoneDemo'
import { DURATION, HEIGHT, KovaPhoneFilm, WIDTH } from './KovaPhoneFilm'

function Root() {
  return (
    <>
      <Composition id="KovaPhoneDemo" component={KovaPhoneDemo} durationInFrames={DEMO_DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
      <Composition id="KovaPhoneFilm" component={KovaPhoneFilm} durationInFrames={DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
    </>
  )
}

registerRoot(Root)
