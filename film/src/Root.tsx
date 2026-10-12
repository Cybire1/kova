import { Composition, Still } from 'remotion'
import { SPOT_DURATION, TableSpot } from './spot/TableSpot'
import { TableTent } from './spot/TableTent'
import { QueueArt } from './queue/QueueArt'
import { QUEUE_DURATION, QueueFilm } from './queue/QueueFilm'
import { TABLE_DURATION, TableFilm } from './queue/TableFilm'
import { LINK_DURATION, LinkFilm } from './link/LinkFilm'
import { CARDS_DURATION, KovaCards } from './KovaCards'
import { DURATION, KovisDay } from './KovisDay'
import { FPS } from './motion'
import { OgCard } from './OgCard'
import { AtmDecal, AtmKey, AtmScreen, AtmSign, AtmTapPad, CardFront, TerminalMark, TerminalReceipt, TerminalScreen } from './atm/Textures'
import { KovaPointShowcase } from './atm/KovaPoint3D'
import { OS_DURATION, ShopOsFilm } from './os/ShopOsFilm'
import { STORE_DURATION, StoreFilm } from './store/StoreFilm'
import { CustomerPaidScreen, CustomerReel, CustomerTapScreen, RegisterReel, TerminalReel, OrdersScreen, SellScreen, TerminalPaidScreen, TerminalSellScreen, TodayScreen } from './os/ui/Screens'
import { ProductArt } from './atm/ProductArt'
import { MerchArt, MerchMenu } from './store/MerchArt'
import { MerchHero } from './store/MerchHero'
import { TERMINAL_DURATION, TerminalFilm } from './terminal/TerminalFilm'
import { TerminalShowcase } from './terminal/TerminalShowcase'
import { KovaPointFilm, POINT_DURATION } from './atm/KovaPointFilm'
import { IPhoneTest } from './IPhoneTest'
import { RigTest } from './RigTest'
import { StatsFlyer } from './flyer/StatsFlyer'
import { StatsLandscape } from './flyer/StatsLandscape'
import { StatsBillboard } from './flyer/StatsBillboard'
import { StatsSign } from './flyer/StatsSign'
import { SHOP_DURATION, ShopLink } from './ShopLink'
import './theme'

export const RemotionRoot = () => (
  <>
    <Composition id="KovisDay" component={KovisDay} durationInFrames={DURATION * FPS} fps={FPS} width={1920} height={1080} />
    <Composition id="KovaPointFilm" component={KovaPointFilm} durationInFrames={POINT_DURATION * FPS} fps={FPS} width={1920} height={1080} />
    <Composition id="SellScreen" component={SellScreen} durationInFrames={150} fps={FPS} width={1440} height={900} />
    <Composition id="RegisterReel" component={RegisterReel} durationInFrames={150} fps={FPS} width={1440} height={900} />
    <Composition id="CustomerReel" component={CustomerReel} durationInFrames={200} fps={FPS} width={1024} height={600} />
    <Composition id="TerminalReel" component={TerminalReel} durationInFrames={170} fps={FPS} width={412} height={824} />
    <Composition id="OrdersScreen" component={OrdersScreen} durationInFrames={240} fps={FPS} width={1440} height={900} />
    <Composition id="TodayScreen" component={TodayScreen} durationInFrames={150} fps={FPS} width={1440} height={900} />
    <Composition id="CustomerTapScreen" component={CustomerTapScreen} durationInFrames={120} fps={FPS} width={1024} height={600} />
    <Composition id="CustomerPaidScreen" component={CustomerPaidScreen} durationInFrames={180} fps={FPS} width={1024} height={600} />
    <Composition id="TerminalSellScreen" component={TerminalSellScreen} durationInFrames={120} fps={FPS} width={412} height={824} />
    <Composition id="TerminalPaidScreen" component={TerminalPaidScreen} durationInFrames={120} fps={FPS} width={412} height={824} />
    <Composition id="StoreFilm" component={StoreFilm} durationInFrames={STORE_DURATION * FPS} fps={FPS} width={1920} height={1080} />
    <Composition id="ShopOsFilm" component={ShopOsFilm} durationInFrames={OS_DURATION * FPS} fps={FPS} width={1920} height={1080} />
    <Composition id="TerminalFilm" component={TerminalFilm} durationInFrames={TERMINAL_DURATION * FPS} fps={FPS} width={1920} height={1080} />
    <Composition id="TerminalShowcase" component={TerminalShowcase} durationInFrames={240} fps={FPS} width={1920} height={1080} />
    <Composition id="KovaPoint" component={KovaPointShowcase} durationInFrames={300} fps={FPS} width={1920} height={1080} />
    <Still id="MerchArt" component={MerchArt} width={600} height={600} defaultProps={{ kind: 'mug' as const }} />
    <Still id="MerchHero" component={MerchHero} width={1200} height={1200} defaultProps={{ kind: 'mug' as const }} />
    <Still id="MerchMenu" component={MerchMenu} width={1200} height={1500} />
    <Still id="ProductArt" component={ProductArt} width={600} height={600} defaultProps={{ kind: 'croissant' as const }} />
    <Still id="TerminalScreen" component={TerminalScreen} width={900} height={1800} defaultProps={{ screen: 'charge' as const }} />
    <Still id="TerminalReceipt" component={TerminalReceipt} width={600} height={1500} />
    <Still id="TerminalMark" component={TerminalMark} width={512} height={512} defaultProps={{ kind: 'contactless' as const, ink: '#0b1a1d' }} />
    <Still id="AtmScreen" component={AtmScreen} width={1200} height={900} defaultProps={{ screen: 'tap' as const }} />
    <Still id="AtmSign" component={AtmSign} width={1600} height={400} />
    <Still id="AtmDecal" component={AtmDecal} width={1000} height={640} />
    <Still id="AtmTapPad" component={AtmTapPad} width={600} height={600} />
    <Still id="AtmKey" component={AtmKey} width={256} height={256} defaultProps={{ label: '1', tone: 'paper' as const }} />
    <Still id="CardFront" component={CardFront} width={638} height={1012} defaultProps={{ id: 'main' as const }} />
    <Composition id="IPhoneTest" component={IPhoneTest} durationInFrames={30} fps={FPS} width={1920} height={1080} />
    <Composition id="ShopLink" component={ShopLink} durationInFrames={SHOP_DURATION * FPS} fps={FPS} width={1920} height={1080} />
    <Composition id="KovaCards" component={KovaCards} durationInFrames={Math.round(CARDS_DURATION * FPS)} fps={FPS} width={1920} height={1080} />
    {/* The link preview for mykova.app. */}
    <Still id="RigTest" component={RigTest} width={1920} height={1080} />
    <Still id="KovaCard" component={OgCard} width={1200} height={630} />
    <Composition id="TableSpot" component={TableSpot} durationInFrames={SPOT_DURATION * FPS} fps={FPS} width={1920} height={1080} />
    <Still id="TableTent" component={TableTent} width={1333} height={1000} />
    <Composition id="LinkFilm" component={LinkFilm} durationInFrames={LINK_DURATION * FPS} fps={FPS} width={1920} height={1080} />
    <Composition id="TableFilm" component={TableFilm} durationInFrames={TABLE_DURATION * FPS} fps={FPS} width={1920} height={1080} />
    <Composition id="QueueFilm" component={QueueFilm} durationInFrames={QUEUE_DURATION * FPS} fps={FPS} width={1920} height={1080} />
    {/* Kova's numbers on Monad, for X: read the live stats and pass them as props. */}
    <Still id="StatsFlyer" component={StatsFlyer} width={1080} height={1350} defaultProps={{ payments: 230, volume: '1651.70', shops: 18, asOf: '12 Oct 2026' }} />
    <Still id="StatsLandscape" component={StatsLandscape} width={1600} height={900} defaultProps={{ payments: 230, wallets: 108, walletsThisWeek: 40, shops: 18, volume: '1651.70', asOf: '12 Oct 2026' }} />
    <Still id="StatsBillboard" component={StatsBillboard} width={1600} height={900} defaultProps={{ payments: 230, wallets: 108, shops: 18, volume: '1651.70', asOf: '12 Oct 2026' }} />
    <Still id="StatsSign" component={StatsSign} width={1600} height={900} defaultProps={{ payments: 230, wallets: 108, shops: 18, volume: '1651.70', ground: '#E4E4DE', swing: 2 }} />
    <Still id="QueueArt" component={QueueArt} width={1000} height={1000} defaultProps={{ kind: 'wait' as const, n: 3 }} />
  </>
)
