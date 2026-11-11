/** Its own entry, so the film's Root (tracked in git) stays as submitted. */
import { Composition, registerRoot } from 'remotion'
import { FPS, IOS_DURATION, IosBetaFilm } from './IosBetaFilm'

function Root() {
  return <Composition id="IosBetaFilm" component={IosBetaFilm} durationInFrames={IOS_DURATION} fps={FPS} width={1920} height={1080} />
}

registerRoot(Root)
