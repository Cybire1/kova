import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import { type Place, searchPlaces } from '@/lib/api'
import { colors, fonts } from '@/lib/theme'
import { Icon } from '../Icon'
import { Txt } from '../primitives'
import { Sheet } from './Sheet'

/** Airports and cities as you type, for a flight's ends or a hotel's city. */
export function PlaceSheet({
  visible,
  title,
  onClose,
  onPick,
}: {
  visible: boolean
  title: string
  onClose: () => void
  onPick: (p: Place) => void
}) {
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState<Place[]>([])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) {
      setQuery('')
      setPlaces([])
      setProblem(null)
    }
  }, [visible])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return setPlaces([])
    setBusy(true)
    const id = setTimeout(() => {
      searchPlaces(q)
        .then((p) => {
          setPlaces(p)
          setProblem(null)
        })
        .catch((error: Error) => setProblem(error.message))
        .finally(() => setBusy(false))
    }, 250)
    return () => clearTimeout(id)
  }, [query])

  return (
    <Sheet visible={visible} onClose={onClose} title={title} tall>
      <View style={styles.search}>
        <Icon name="scan" size={18} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="City or airport, like Lisbon or LHR"
          placeholderTextColor="#8C9799"
          autoFocus
          autoCorrect={false}
          style={styles.input}
        />
        {busy ? <ActivityIndicator color={colors.ink} size="small" /> : null}
      </View>
      {problem ? (
        <Txt size={14} color={colors.danger} style={{ marginTop: 10 }}>
          {problem}
        </Txt>
      ) : null}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingVertical: 8 }}
      >
        {places.map((p) => (
          <Pressable
            key={`${p.type}:${p.iata}`}
            accessibilityRole="button"
            onPress={() => onPick(p)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.sunken }]}
          >
            <View style={[styles.badge, p.type === 'city' && { backgroundColor: colors.tealSoft }]}>
              <Txt weight="bold" size={13}>
                {p.iata}
              </Txt>
            </View>
            <View style={{ flex: 1 }}>
              <Txt weight="semi" size={16} numberOfLines={1}>
                {p.type === 'city' ? `${p.name}, all airports` : p.name}
              </Txt>
              <Txt size={13} color={colors.muted} numberOfLines={1}>
                {p.type === 'city' ? p.country : `${p.city}, ${p.country}`}
              </Txt>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    marginTop: 8,
    paddingHorizontal: 16,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.surface,
  },
  input: { flex: 1, fontFamily: fonts.medium, fontSize: 16, color: colors.ink },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 16,
  },
  badge: {
    width: 46,
    height: 32,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
