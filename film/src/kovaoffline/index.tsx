/** Its own entry, so the film's Root (tracked in git) stays as submitted. */
import { Composition, registerRoot } from 'remotion'
import { FPS } from '../motion'
import { DURATION, HEIGHT, KovaOfflineFilm, WIDTH } from './KovaOfflineFilm'

function Root() {
  return <Composition id="KovaOfflineFilm" component={KovaOfflineFilm} durationInFrames={DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
}

registerRoot(Root)
