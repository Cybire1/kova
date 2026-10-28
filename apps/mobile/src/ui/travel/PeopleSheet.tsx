import * as Haptics from 'expo-haptics'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { colors } from '@/lib/theme'
import { PillButton, Txt } from '../primitives'
import { Stepper } from '../StallParts'
import { Sheet } from './Sheet'

export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first'
export interface People {
  adults: number
  children: number
  infants: number
  cabin: Cabin
  rooms: number
}

export const cabins: { id: Cabin; label: string }[] = [
  { id: 'economy', label: 'Economy' },
  { id: 'premium_economy', label: 'Premium' },
  { id: 'business', label: 'Business' },
  { id: 'first', label: 'First' },
]

export function peopleText(p: People, kind: 'flight' | 'stay') {
  const n = p.adults + p.children + (kind === 'flight' ? p.infants : 0)
  const who = `${n} ${kind === 'flight' ? (n === 1 ? 'traveller' : 'travellers') : n === 1 ? 'guest' : 'guests'}`
  return kind === 'flight'
    ? `${who}, ${cabins.find((c) => c.id === p.cabin)?.label ?? 'Economy'}`
    : `${who}, ${p.rooms} ${p.rooms === 1 ? 'room' : 'rooms'}`
}

/** Who's going: adults, children and babies, and the cabin (flights) or rooms (hotels). */
export function PeopleSheet({
  visible,
  kind,
  value,
  onClose,
  onDone,
}: {
  visible: boolean
  kind: 'flight' | 'stay'
  value: People
  onClose: () => void
  onDone: (p: People) => void
}) {
  const [p, setP] = useState(value)
  useEffect(() => {
    if (visible) setP(value)
  }, [visible, value])

  const row = (
    label: string,
    hint: string,
    key: 'adults' | 'children' | 'infants' | 'rooms',
    min: number,
    max: number,
  ) => (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Txt weight="semi" size={16}>
          {label}
        </Txt>
        <Txt size={13} color={colors.muted}>
          {hint}
        </Txt>
      </View>
      {p[key] <= min ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add ${label.toLowerCase()}`}
          onPress={() => setP({ ...p, [key]: min + 1 })}
          style={styles.add}
        >
          <Txt weight="bold" size={15}>
            {min}
          </Txt>
          <Txt weight="bold" size={18}>
            +
          </Txt>
        </Pressable>
      ) : (
        <Stepper
          value={p[key]}
          name={label}
          max={max}
          onChange={(n) =>
            setP({
              ...p,
              [key]: Math.max(min, n),
              ...(key === 'adults' && p.infants > n ? { infants: n } : {}),
            })
          }
          small
        />
      )}
    </View>
  )

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={kind === 'flight' ? 'Who’s flying' : 'Who’s staying'}
    >
      <View style={styles.group}>
        {row('Adults', '12 and over', 'adults', 1, 9)}
        {row('Children', '2 to 11', 'children', 0, 8)}
        {kind === 'flight'
          ? row('Babies', 'Under 2, on a lap', 'infants', 0, p.adults)
          : row('Rooms', 'How many to book', 'rooms', 1, 8)}
      </View>
      {kind === 'flight' ? (
        <>
          <Txt
            weight="semi"
            size={14}
            color={colors.muted}
            style={{ marginTop: 18, marginBottom: 8, marginLeft: 4 }}
          >
            Cabin
          </Txt>
          <View style={styles.cabins}>
            {cabins.map((c) => {
              const on = c.id === p.cabin
              return (
                <Pressable
                  key={c.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    void Haptics.selectionAsync()
                    setP({ ...p, cabin: c.id })
                  }}
                  style={[styles.cabin, on && { backgroundColor: colors.chosen }]}
                >
                  <Txt weight="semi" size={14} color={on ? colors.onChosen : colors.ink}>
                    {c.label}
                  </Txt>
                </Pressable>
              )
            })}
          </View>
        </>
      ) : null}
      <View style={{ marginTop: 20 }}>
        <PillButton label="Done" icon="check" onPress={() => onDone(p)} />
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  group: {
    marginTop: 10,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: colors.sunken,
  },
  add: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.line,
  },
  cabins: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cabin: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.line,
    justifyContent: 'center',
  },
})
