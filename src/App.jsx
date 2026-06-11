import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from './lib/supabaseClient'
import {
  Shield, Calendar, TrendingUp, Users, RefreshCw, Search,
  ArrowUpDown, Lock, LogOut, AlertCircle, Flame, PlusCircle,
  Edit2, Trash2, Check, X, ChevronDown, BarChart2, TableIcon,
  ArrowUp, ArrowDown, Download
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell
} from 'recharts'

// ─── Helpers ───────────────────────────────────────────────────────────────

const fmt = (n) => {
  if (n === null || n === undefined) return '0'
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return Number(n).toLocaleString()
}

const fmtDate = (iso) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const fmtShortDate = (iso) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const DeltaCell = ({ value, pct }) => {
  const isPos = value > 0
  const isNeg = value < 0
  return (
    <div className={`flex flex-col items-end font-bold tabular-nums ${isPos ? 'text-emerald-400' : isNeg ? 'text-red-400' : 'text-slate-500'}`}>
      <span>{isPos ? '+' : ''}{fmt(value)}</span>
      {pct !== undefined && (
        <span className="text-[10px] font-semibold opacity-70">
          {isPos ? '+' : ''}{pct.toFixed(1)}%
        </span>
      )}
    </div>
  )
}

const SortIcon = ({ field, sortBy, sortOrder }) =>
  sortBy === field
    ? sortOrder === 'asc' ? <ArrowUp size={11} className="text-amber-400" /> : <ArrowDown size={11} className="text-amber-400" />
    : <ArrowUpDown size={11} className="text-slate-600" />

// ─── Main App ───────────────────────────────────────────────────────────────

function App() {
  // ── Auth
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  // ── Data
  const [events, setEvents] = useState([])
  const [players, setPlayers] = useState([])
  const [leaderboard, setLeaderboard] = useState([])
  const [comparisonData, setComparisonData] = useState([])

  // ── Loading
  const [loading, setLoading] = useState(true)
  const [lbLoading, setLbLoading] = useState(false)

  // ── View mode
  const [activeTab, setActiveTab] = useState('comparison') // 'comparison' | 'single' | 'players' | 'events'

  // ── Event selection
  const [selectedEvent, setSelectedEvent] = useState(null)    // for single event view
  const [compareEventA, setCompareEventA] = useState(null)    // start event
  const [compareEventB, setCompareEventB] = useState(null)    // end event

  // ── Sort / Search / Filter
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState('end_might')
  const [sortOrder, setSortOrder] = useState('desc')
  const [filterAlliance, setFilterAlliance] = useState('')
  const [filterKingdom, setFilterKingdom] = useState('')
  const [showChart, setShowChart] = useState(false)

  // ── RPC error state
  const [rpcError, setRpcError] = useState(null)

  // ── Admin forms
  const [newEvent, setNewEvent] = useState({ name: '', start_date: '', end_date: '', parent_id: '', event_type: 'standard' })
  const [editingEvent, setEditingEvent] = useState(null)
  const [editingPlayer, setEditingPlayer] = useState(null)

  // ── Merge Player state
  const [showMergeModal, setShowMergeModal] = useState(false)
  const [mergeOldPlayerId, setMergeOldPlayerId] = useState('')
  const [mergeNewPlayerId, setMergeNewPlayerId] = useState('')

  // ── Init ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        setUser(session.user)
        await checkAdmin(session.user.id)
      }
      supabase.auth.onAuthStateChange(async (_e, session) => {
        if (session) { setUser(session.user); await checkAdmin(session.user.id) }
        else { setUser(null); setIsAdmin(false) }
      })
      await loadAll()
    }
    init()
  }, [])

  // Re-run comparison when either event changes
  useEffect(() => {
    if (compareEventA && compareEventB) buildComparison()
    else setComparisonData([])
  }, [compareEventA, compareEventB])

  // Re-run single leaderboard
  useEffect(() => {
    if (selectedEvent) fetchLeaderboard(selectedEvent)
    else setLeaderboard([])
  }, [selectedEvent])

  // ── Auth helpers ──────────────────────────────────────────────────────────

  const checkAdmin = async (userId) => {
    const { data: { user: u } } = await supabase.auth.getUser()
    setIsAdmin(u?.user_metadata?.role === 'admin' || u?.app_metadata?.role === 'admin' || false)
  }

  const handleAuth = async (e) => {
    e.preventDefault()
    setAuthError('')
    setAuthLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })
      if (error) throw error
      setShowAuthModal(false)
    } catch (err) {
      setAuthError(err.message)
    } finally {
      setAuthLoading(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  // ── Data loaders ──────────────────────────────────────────────────────────

  const loadAll = async () => {
    setLoading(true)
    await Promise.all([fetchEvents(), fetchPlayers()])
    setLoading(false)
  }

  const fetchEvents = async () => {
    const { data } = await supabase.from('events').select('*').order('start_date', { ascending: false })
    if (data) {
      setEvents(data)
      if (data.length >= 2 && !compareEventA && !compareEventB) {
        setCompareEventA(data[1])   // older = start
        setCompareEventB(data[0])   // newer = end
      }
      if (data.length >= 1 && !selectedEvent) setSelectedEvent(data[0])
    }
  }

  const fetchPlayers = async () => {
    const { data } = await supabase.from('players').select('*').order('name', { ascending: true })
    if (data) setPlayers(data)
  }

  const fetchLeaderboard = async (ev) => {
    setLbLoading(true)
    setRpcError(null)
    const rpcName = ev.event_type === 'campaign' ? 'get_campaign_leaderboard' : 'get_event_leaderboard'
    const rpcParam = ev.event_type === 'campaign' ? { campaign_event_id: ev.id } : { event_id: ev.id }

    const { data, error } = await supabase.rpc(rpcName, rpcParam)
    if (error) {
      console.error('RPC error:', error)
      setRpcError(`RPC error: ${error.message}. Make sure to run the GRANT EXECUTE SQL in Supabase.`)
      setLeaderboard([])
    } else {
      setLeaderboard(data || [])
    }
    setLbLoading(false)
  }

  const buildComparison = async () => {
    if (!compareEventA || !compareEventB) return
    setLbLoading(true)
    setRpcError(null)

    const rpcNameA = compareEventA.event_type === 'campaign' ? 'get_campaign_leaderboard' : 'get_event_leaderboard'
    const rpcParamA = compareEventA.event_type === 'campaign' ? { campaign_event_id: compareEventA.id } : { event_id: compareEventA.id }

    const rpcNameB = compareEventB.event_type === 'campaign' ? 'get_campaign_leaderboard' : 'get_event_leaderboard'
    const rpcParamB = compareEventB.event_type === 'campaign' ? { campaign_event_id: compareEventB.id } : { event_id: compareEventB.id }

    const [resA, resB] = await Promise.all([
      supabase.rpc(rpcNameA, rpcParamA),
      supabase.rpc(rpcNameB, rpcParamB),
    ])

    if (resA.error || resB.error) {
      const err = resA.error || resB.error
      console.error('RPC error:', err)
      setRpcError(`RPC error: ${err.message}. Run the GRANT EXECUTE statement in Supabase SQL editor.`)
      setComparisonData([])
      setLbLoading(false)
      return
    }
    const startMap = {}
      ; (resA.data || []).forEach(r => { startMap[r.player_name.toLowerCase()] = r })

    const rows = (resB.data || []).map(endRow => {
      const key = endRow.player_name.toLowerCase()
      const startRow = startMap[key] || null
      const startPower = startRow?.end_might ?? 0
      const startKills = startRow?.end_kills ?? 0
      const endPower = endRow.end_might ?? 0
      const endKills = endRow.end_kills ?? 0
      const powerDelta = endPower - startPower
      const killsDelta = endKills - startKills
      const powerPct = startPower ? (powerDelta / startPower) * 100 : 0
      const killsPct = startKills ? (killsDelta / startKills) * 100 : 0
      const killMightRatio = powerDelta > 0 ? (killsDelta / powerDelta) : 0
      const renamed = startRow && startRow.player_name !== endRow.player_name

      return {
        player_id: endRow.player_id,
        player_name_before: startRow?.player_name ?? '—',
        player_name_now: endRow.player_name,
        note: renamed ? 'Renamed' : '',
        alliance: endRow.alliance,
        kingdom: endRow.kingdom,
        start_date: compareEventA.start_date,
        end_date: compareEventB.end_date,
        start_power: startPower,
        end_power: endPower,
        power_delta: powerDelta,
        power_pct: powerPct,
        start_kills: startKills,
        end_kills: endKills,
        kills_delta: killsDelta,
        kills_pct: killsPct,
        kill_might_ratio: killMightRatio,
        start_act: startRow?.net_kills_gain ?? 0,
        end_act: endRow.net_kills_gain ?? 0,
      }
    })
    setComparisonData(rows)
    setLbLoading(false)
  }

  // ── Sort / filter ─────────────────────────────────────────────────────────

  const handleSort = (field) => {
    if (sortBy === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortOrder('desc') }
  }

  const filteredComparison = [...comparisonData]
    .filter(r =>
      (r.player_name_now.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.player_name_before.toLowerCase().includes(searchTerm.toLowerCase())) &&
      (filterAlliance === '' || (r.alliance && r.alliance.toLowerCase() === filterAlliance.toLowerCase()))
    )
    .sort((a, b) => {
      const va = a[sortBy], vb = b[sortBy]
      if (typeof va === 'string') return sortOrder === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
      return sortOrder === 'asc' ? va - vb : vb - va
    })

  const filteredLeaderboard = [...leaderboard]
    .filter(r =>
      r.player_name.toLowerCase().includes(searchTerm.toLowerCase()) &&
      (filterAlliance === '' || (r.alliance && r.alliance.toLowerCase() === filterAlliance.toLowerCase()))
    )
    .sort((a, b) => {
      const va = a[sortBy], vb = b[sortBy]
      if (typeof va === 'string') return sortOrder === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
      return sortOrder === 'asc' ? va - vb : vb - va
    })

  const uniqueAlliances = Array.from(new Set(players.map(p => p.alliance).filter(Boolean))).sort()
  const uniqueKingdoms = Array.from(new Set(players.map(p => p.kingdom).filter(Boolean))).sort()

  const filteredPlayers = players.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
    (filterKingdom === '' || (p.kingdom && p.kingdom.toLowerCase() === filterKingdom.toLowerCase()))
  )

  // ── Exports ───────────────────────────────────────────────────────────────

  const exportToCSV = (data, filename) => {
    if (!data.length) return
    const headers = Object.keys(data[0]).join(',')
    const rows = data.map(row =>
      Object.values(row).map(v => {
        if (v === null || v === undefined) return ''
        const val = String(v)
        return val.includes(',') ? `"${val}"` : val
      }).join(',')
    )
    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].join("\n")
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement("a")
    link.setAttribute("href", encodedUri)
    link.setAttribute("download", `${filename}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleExportComparison = () => {
    const exportData = filteredComparison.map((r, i) => ({
      Rank: i + 1,
      'Player Name Before': r.player_name_before,
      'Player Name Now': r.player_name_now,
      Alliance: r.alliance,
      Kingdom: r.kingdom,
      'Start Power': r.start_power,
      'End Power': r.end_power,
      'Power Delta': r.power_delta,
      'Start Kills': r.start_kills,
      'End Kills': r.end_kills,
      'Kills Delta': r.kills_delta,
      'Kill/Might Ratio': r.power_delta > 0 ? (r.kills_delta / r.power_delta).toFixed(2) : 0
    }))
    exportToCSV(exportData, 'VikingRise_Comparison')
  }

  const handleExportSingle = () => {
    const exportData = filteredLeaderboard.map((r, i) => ({
      Rank: i + 1,
      Player: r.player_name,
      Alliance: r.alliance,
      Kingdom: r.kingdom,
      'Start Power': r.start_might,
      'End Power': r.end_might,
      'Power Delta': r.net_might_gain,
      'Start Kills': r.start_kills,
      'End Kills': r.end_kills,
      'Kills Delta': r.net_kills_gain
    }))
    exportToCSV(exportData, 'VikingRise_EventStats')
  }

  // ── Admin CRUD ────────────────────────────────────────────────────────────

  const handleCreateEvent = async (e) => {
    e.preventDefault()
    const { error } = await supabase.from('events').insert({
      name: newEvent.name,
      start_date: new Date(newEvent.start_date).toISOString(),
      end_date: new Date(newEvent.end_date).toISOString(),
      parent_id: newEvent.parent_id || null,
      event_type: newEvent.event_type || 'standard'
    })
    if (!error) { setNewEvent({ name: '', start_date: '', end_date: '', parent_id: '', event_type: 'standard' }); fetchEvents() }
    else alert(`Error: ${error.message}`)
  }

  const handleUpdateEvent = async (ev) => {
    const { error } = await supabase.from('events').update({
      name: ev.name,
      start_date: new Date(ev.start_date).toISOString(),
      end_date: new Date(ev.end_date).toISOString(),
    }).eq('id', ev.id)
    if (!error) { setEditingEvent(null); fetchEvents() }
    else alert(`Error: ${error.message}`)
  }

  const handleDeleteEvent = async (id) => {
    if (!confirm('Delete this event?')) return
    await supabase.from('events').delete().eq('id', id)
    fetchEvents()
  }

  const handleUpdatePlayer = async (p) => {
    const { error } = await supabase.from('players').update({
      name: p.name,
      alliance: p.alliance,
      kingdom: p.kingdom,
      note: p.note,
    }).eq('id', p.id)
    if (!error) { setEditingPlayer(null); fetchPlayers() }
    else alert(`Error: ${error.message}`)
  }

  const handleDeletePlayer = async (id) => {
    if (!confirm('Delete this player and all their snapshots?')) return
    await supabase.from('players').delete().eq('id', id)
    fetchPlayers()
  }

  const handleMergePlayers = async () => {
    if (!mergeOldPlayerId || !mergeNewPlayerId) return alert('Select both players')
    if (mergeOldPlayerId === mergeNewPlayerId) return alert('Cannot merge a player with themselves')

    if (!confirm('Are you sure? This will move all snapshots from the old player to the new player and DELETE the old player profile. This cannot be undone.')) return

    const { error } = await supabase.rpc('merge_players', {
      old_player_id: mergeOldPlayerId,
      new_player_id: mergeNewPlayerId
    })

    if (error) {
      alert(`Merge failed: ${error.message}`)
    } else {
      setShowMergeModal(false)
      setMergeOldPlayerId('')
      setMergeNewPlayerId('')
      fetchPlayers()
      buildComparison() // Refresh data if they were looking at it
    }
  }

  // ── Aggregates ────────────────────────────────────────────────────────────

  const totalPowerDelta = filteredComparison.reduce((s, r) => s + r.power_delta, 0)
  const totalKillsDelta = filteredComparison.reduce((s, r) => s + r.kills_delta, 0)
  const totalPower = filteredComparison.reduce((s, r) => s + r.end_power, 0)
  const totalStartPower = filteredComparison.reduce((s, r) => s + r.start_power, 0)
  const totalKills = filteredComparison.reduce((s, r) => s + r.end_kills, 0)
  const topPowerGainer = [...filteredComparison].sort((a, b) => b.power_delta - a.power_delta)[0]
  const topKillsGainer = [...filteredComparison].sort((a, b) => b.kills_delta - a.kills_delta)[0]

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col">

      {/* ── HEADER ── */}
      <header className="sticky top-0 z-40 border-b border-white/5 glass-panel">
        <div className="max-w-[1600px] mx-auto px-4 h-16 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="bg-gradient-to-br from-amber-400 to-orange-600 p-1.5 rounded-lg shadow-lg shadow-amber-500/20">
              <Shield size={20} className="text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <h1 className="font-black text-base tracking-tight bg-gradient-to-r from-amber-300 to-orange-400 bg-clip-text text-transparent leading-none">
                VIKING RISE
              </h1>
              <p className="text-[10px] text-slate-500 font-semibold leading-none mt-0.5">Clan Performance Tracker</p>
            </div>
          </div>

          {/* Tabs */}
          <nav className="flex items-center gap-1 bg-white/5 rounded-lg p-1 text-xs font-bold">
            {[
              { id: 'comparison', icon: <BarChart2 size={13} />, label: 'Compare' },
              { id: 'single', icon: <TrendingUp size={13} />, label: 'Event Stats' },
              ...(isAdmin ? [
                { id: 'players', icon: <Users size={13} />, label: 'Players' },
                { id: 'events', icon: <Calendar size={13} />, label: 'Events' },
              ] : []),
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setSearchTerm('') }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all ${activeTab === tab.id
                  ? 'btn-primary'
                  : 'text-slate-400 hover:text-white hover:bg-white/10'
                  }`}
              >
                <div className="relative z-10 flex items-center gap-1.5">{tab.icon}{tab.label}</div>
              </button>
            ))}
          </nav>

          {/* Auth */}
          <div className="shrink-0">
            {user ? (
              <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full pl-3 pr-1 py-1">
                <span className="text-xs text-slate-300 font-medium hidden sm:block">{user.email}</span>
                {isAdmin && <span className="text-[10px] bg-amber-500/20 text-amber-400 font-bold px-1.5 py-0.5 rounded-full">Admin</span>}
                <button onClick={handleLogout} className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-red-400">
                  <LogOut size={14} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setAuthError(''); setShowAuthModal(true) }}
                className="flex items-center gap-1.5 btn-primary text-xs px-4 py-2"
              >
                <div className="relative z-10 flex items-center gap-1.5"><Lock size={13} />Admin Login</div>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── MAIN ── */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 py-6 space-y-6">

        {loading ? (
          <div className="flex items-center justify-center py-32 text-slate-500">
            <RefreshCw size={20} className="animate-spin mr-3" />Loading data...
          </div>
        ) : (

          <>

            {/* RPC error banner */}
            {rpcError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-5 py-4 flex items-start gap-3">
                <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-red-300 mb-1">Database Function Error</p>
                  <p className="text-xs text-red-400/80 mb-3">{rpcError}</p>
                  <div className="bg-black/30 rounded-lg px-3 py-2 font-mono text-xs text-slate-300 select-all">
                    GRANT EXECUTE ON FUNCTION public.get_event_leaderboard(uuid) TO anon, authenticated;
                  </div>
                  <p className="text-[11px] text-slate-600 mt-2">Run the line above in your <strong className="text-slate-500">Supabase SQL Editor</strong>, then refresh.</p>
                </div>
                <button onClick={() => setRpcError(null)} className="text-slate-600 hover:text-slate-400"><X size={16} /></button>
              </div>
            )}

            {/* ══════════════════════════════════════════════
            TAB: COMPARISON
        ══════════════════════════════════════════════ */}
            {activeTab === 'comparison' && (
              <>
                {/* Controls */}
                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
                  <div className="flex flex-col sm:flex-row gap-3 flex-1">
                    <div className="flex flex-col gap-1 flex-1">
                      <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Start Event (Before)</label>
                      <select
                        className="bg-white/5 border border-white/10 text-slate-200 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500/40 appearance-none"
                        value={compareEventA?.id || ''}
                        onChange={e => setCompareEventA(events.find(ev => ev.id === e.target.value) || null)}
                      >
                        <option value="">— Select start event —</option>
                        {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name} ({fmtShortDate(ev.start_date)})</option>)}
                      </select>
                    </div>

                    <div className="flex items-end pb-2 text-slate-600 font-black text-lg hidden sm:block">→</div>

                    <div className="flex flex-col gap-1 flex-1">
                      <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">End Event (Now)</label>
                      <select
                        className="bg-white/5 border border-white/10 text-slate-200 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500/40 appearance-none"
                        value={compareEventB?.id || ''}
                        onChange={e => setCompareEventB(events.find(ev => ev.id === e.target.value) || null)}
                      >
                        <option value="">— Select end event —</option>
                        {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name} ({fmtShortDate(ev.end_date)})</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 self-end flex-wrap sm:flex-nowrap justify-end mt-2 sm:mt-0">
                    <button
                      onClick={handleExportComparison}
                      disabled={filteredComparison.length === 0}
                      className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Export to CSV"
                    >
                      <Download size={14} /> <span className="hidden sm:inline">Export</span>
                    </button>
                    <select
                      className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                      value={filterAlliance}
                      onChange={e => setFilterAlliance(e.target.value)}
                    >
                      <option value="">All Alliances</option>
                      {uniqueAlliances.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        type="text"
                        placeholder="Search player..."
                        className="bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/30 w-44 sm:w-52"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* Summary stats */}
                {comparisonData.length > 0 && (
                  <div className={`grid grid-cols-2 ${filterAlliance ? 'lg:grid-cols-7' : 'lg:grid-cols-4'} gap-4`}>
                    {[
                      { label: filterAlliance ? `${filterAlliance} Players` : 'Players Tracked', value: filteredComparison.length, sub: 'in current view', color: 'text-amber-400' },
                      ...(filterAlliance ? [
                        { label: 'Start Tribe Might', value: fmt(totalStartPower), sub: 'At start', color: 'text-slate-300' },
                        { label: 'End Tribe Might', value: fmt(totalPower), sub: 'At end', color: 'text-white' }
                      ] : []),
                      { label: 'Total Power Δ', value: fmt(totalPowerDelta), sub: totalPowerDelta > 0 ? 'Net gain' : 'Net loss', color: totalPowerDelta >= 0 ? 'text-emerald-400' : 'text-red-400' },
                      { label: 'Total Kill Δ', value: fmt(totalKillsDelta), sub: totalKillsDelta > 0 ? 'Net gain' : 'Net loss', color: totalKillsDelta >= 0 ? 'text-emerald-400' : 'text-red-400' },
                      ...(filterAlliance ? [
                        { label: 'Total Kills', value: fmt(totalKills), sub: 'Total accumulated', color: 'text-purple-400' }
                      ] : []),
                      { label: 'Top Power Gainer', value: topPowerGainer?.player_name_now ?? '—', sub: topPowerGainer ? `+${fmt(topPowerGainer.power_delta)}` : '', color: 'text-sky-400' },
                    ].map((card, i) => (
                      <div key={card.label} className="premium-card">
                        <p className="text-[10px] font-bold uppercase text-slate-500 tracking-wider mb-2">{card.label}</p>
                        <p className={`text-2xl font-black truncate ${card.color}`}>{card.value}</p>
                        <p className="text-[11px] text-slate-400 mt-1">{card.sub}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Title bar */}
                {compareEventA && compareEventB && (
                  <div className="flex items-center gap-3 py-2 border-b border-white/5">
                    <TableIcon size={16} className="text-amber-400" />
                    <h2 className="font-black text-sm tracking-wide text-slate-200 uppercase">
                      TRIBE MEMBER COMPARISON
                      <span className="text-amber-400 mx-2">|</span>
                      {compareEventA.name} <span className="text-slate-500">({fmtShortDate(compareEventA.start_date)})</span>
                      <span className="text-slate-500 mx-2">vs</span>
                      {compareEventB.name} <span className="text-slate-500">({fmtShortDate(compareEventB.end_date)})</span>
                    </h2>
                  </div>
                )}

                {/* Comparison Table */}
                <div className="glass-panel rounded-2xl overflow-hidden animate-fade-in stagger-2">
                  {lbLoading ? (
                    <div className="flex items-center justify-center py-20 text-slate-500">
                      <RefreshCw size={18} className="animate-spin mr-2" />Computing comparison...
                    </div>
                  ) : !compareEventA || !compareEventB ? (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-600 gap-2">
                      <BarChart2 size={40} strokeWidth={1} />
                      <p className="text-sm font-semibold">Select two events above to compare</p>
                    </div>
                  ) : filteredComparison.length === 0 && comparisonData.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-600 gap-3">
                      <BarChart2 size={40} strokeWidth={1} />
                      <p className="text-sm font-semibold">No snapshot data for the selected events.</p>
                      <p className="text-xs text-slate-700 max-w-sm text-center">Make sure you ran the scraper while one of these events was active, or pick a different event pair. The <span className="text-amber-600 font-bold">farming event</span> has real data.</p>
                    </div>
                  ) : filteredComparison.length === 0 ? (
                    <div className="flex items-center justify-center py-20 text-slate-600 text-sm">No players match your search.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="premium-table">
                        <thead>
                          <tr>
                            <th className="w-10">#</th>
                            <th className="px-4 py-3 text-left cursor-pointer hover:text-white" onClick={() => handleSort('player_name_before')}>
                              <span className="flex items-center gap-1">Player Name Before <SortIcon field="player_name_before" sortBy={sortBy} sortOrder={sortOrder} /></span>
                            </th>
                            <th className="px-4 py-3 text-left cursor-pointer hover:text-white" onClick={() => handleSort('player_name_now')}>
                              <span className="flex items-center gap-1">Player Name Now <SortIcon field="player_name_now" sortBy={sortBy} sortOrder={sortOrder} /></span>
                            </th>
                            <th className="px-4 py-3 text-left">Note</th>
                            <th className="px-4 py-3 text-left text-slate-600">Start Date</th>
                            <th className="px-4 py-3 text-left text-slate-600">End Date</th>
                            <th className="px-4 py-3 text-right cursor-pointer hover:text-white" onClick={() => handleSort('start_power')}>
                              <span className="flex items-center justify-end gap-1">Start Power <SortIcon field="start_power" sortBy={sortBy} sortOrder={sortOrder} /></span>
                            </th>
                            <th className="px-4 py-3 text-right cursor-pointer hover:text-white" onClick={() => handleSort('end_power')}>
                              <span className="flex items-center justify-end gap-1">End Power <SortIcon field="end_power" sortBy={sortBy} sortOrder={sortOrder} /></span>
                            </th>
                            <th className="px-4 py-3 text-right cursor-pointer hover:text-white" onClick={() => handleSort('power_delta')}>
                              <span className="flex items-center justify-end gap-1 text-amber-400">Power Δ <SortIcon field="power_delta" sortBy={sortBy} sortOrder={sortOrder} /></span>
                            </th>
                            <th className="px-4 py-3 text-right cursor-pointer hover:text-white" onClick={() => handleSort('start_kills')}>
                              <span className="flex items-center justify-end gap-1">Start Kills <SortIcon field="start_kills" sortBy={sortBy} sortOrder={sortOrder} /></span>
                            </th>
                            <th className="px-4 py-3 text-right cursor-pointer hover:text-white" onClick={() => handleSort('end_kills')}>
                              <span className="flex items-center justify-end gap-1">End Kills <SortIcon field="end_kills" sortBy={sortBy} sortOrder={sortOrder} /></span>
                            </th>
                            <th className="px-4 py-3 text-right cursor-pointer hover:text-white" onClick={() => handleSort('kills_delta')}>
                              <span className="flex items-center justify-end gap-1 text-amber-400">Kills Δ <SortIcon field="kills_delta" sortBy={sortBy} sortOrder={sortOrder} /></span>
                            </th>
                            <th className="px-4 py-3 text-right cursor-pointer hover:text-white" onClick={() => handleSort('kill_might_ratio')}>
                              <span className="flex items-center justify-end gap-1 text-pink-400">Kill/Might Ratio <SortIcon field="kill_might_ratio" sortBy={sortBy} sortOrder={sortOrder} /></span>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.04]">
                          {filteredComparison.map((row, i) => (
                            <tr key={row.player_id} className="hover:bg-white/[0.03] transition-colors group">
                              <td className="px-4 py-3 font-bold text-slate-500 text-xs w-10">
                                {i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}
                              </td>
                              <td className="px-4 py-3 text-slate-400 font-medium">{row.player_name_before}</td>
                              <td className="px-4 py-3 font-bold text-white">{row.player_name_now}</td>
                              <td className="px-4 py-3">
                                {row.note && (
                                  <span className="text-[10px] font-bold bg-violet-500/20 text-violet-300 px-2 py-0.5 rounded-full">{row.note}</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-xs text-slate-600 font-mono">{fmtShortDate(row.start_date)}</td>
                              <td className="px-4 py-3 text-xs text-slate-600 font-mono">{fmtShortDate(row.end_date)}</td>
                              <td className="px-4 py-3 text-right font-mono text-slate-300 tabular-nums">{fmt(row.start_power)}</td>
                              <td className="px-4 py-3 text-right font-mono text-slate-300 tabular-nums">{fmt(row.end_power)}</td>
                              <td className="px-4 py-3 text-right"><DeltaCell value={row.power_delta} pct={row.power_pct} /></td>
                              <td className="px-4 py-3 text-right font-mono text-slate-300 tabular-nums">{fmt(row.start_kills)}</td>
                              <td className="px-4 py-3 text-right font-mono text-slate-300 tabular-nums">{fmt(row.end_kills)}</td>
                              <td className="px-4 py-3 text-right"><DeltaCell value={row.kills_delta} pct={row.kills_pct} /></td>
                              <td className="px-4 py-3 text-right font-mono tabular-nums font-bold text-pink-300">{row.kill_might_ratio > 0 ? row.kill_might_ratio.toFixed(2) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                        {/* Totals row */}
                        <tfoot className="border-t-2 border-white/10 bg-white/5 font-black text-xs">
                          <tr>
                            <td colSpan={6} className="px-4 py-3 text-slate-400 uppercase tracking-wider">TOTALS ({filteredComparison.length} players)</td>
                            <td colSpan={2} />
                            <td className="px-4 py-3 text-right"><DeltaCell value={filteredComparison.reduce((s, r) => s + r.power_delta, 0)} /></td>
                            <td colSpan={2} />
                            <td className="px-4 py-3 text-right"><DeltaCell value={filteredComparison.reduce((s, r) => s + r.kills_delta, 0)} /></td>
                            <td className="px-4 py-3 text-right text-slate-400">—</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ══════════════════════════════════════════════
            TAB: SINGLE EVENT STATS
        ══════════════════════════════════════════════ */}
            {activeTab === 'single' && (
              <>
                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
                  <div className="flex flex-col gap-1 flex-1 max-w-sm">
                    <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Select Event</label>
                    <select
                      className="bg-white/5 border border-white/10 text-slate-200 rounded-lg px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500/40"
                      value={selectedEvent?.id || ''}
                      onChange={e => setSelectedEvent(events.find(ev => ev.id === e.target.value) || null)}
                    >
                      {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-3 self-end flex-wrap sm:flex-nowrap justify-end mt-2 sm:mt-0">
                    <button
                      onClick={handleExportSingle}
                      disabled={filteredLeaderboard.length === 0}
                      className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Export to CSV"
                    >
                      <Download size={14} /> <span className="hidden sm:inline">Export</span>
                    </button>
                    <label className="flex items-center gap-2 text-xs text-slate-400 mr-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showChart}
                        onChange={e => setShowChart(e.target.checked)}
                        className="rounded border-white/10 bg-white/5 text-amber-500 focus:ring-amber-500/30"
                      />
                      Show Chart
                    </label>
                    <select
                      className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                      value={filterAlliance}
                      onChange={e => setFilterAlliance(e.target.value)}
                    >
                      <option value="">All Alliances</option>
                      {uniqueAlliances.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input type="text" placeholder="Search player..." className="bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/30 w-44 sm:w-52" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                    </div>
                  </div>
                </div>

                {selectedEvent && (
                  <div className="flex items-center gap-4 text-xs text-slate-500 border border-white/5 bg-white/[0.02] rounded-xl px-4 py-3">
                    <Calendar size={14} className="text-amber-400" />
                    <span>{selectedEvent.name}</span>
                    <span className="text-slate-700">•</span>
                    <span>{fmtDate(selectedEvent.start_date)} → {fmtDate(selectedEvent.end_date)}</span>
                  </div>
                )}

                {/* Chart */}
                {showChart && filteredLeaderboard.length > 0 && (() => {
                  // Sort by end_might (absolute power) for the chart — always has real data
                  const chartData = [...filteredLeaderboard]
                    .sort((a, b) => b.end_might - a.end_might)
                    .slice(0, 10)
                    .map(r => ({
                      name: r.player_name.length > 10 ? r.player_name.slice(0, 10) + '…' : r.player_name,
                      'Power': r.end_might,
                      'Power Gain': r.net_might_gain,
                    }))

                  const hasDelta = filteredLeaderboard.some(r => r.net_might_gain !== 0)

                  return (
                    <div className="bg-white/[0.03] border border-white/5 rounded-2xl p-5">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-sm text-slate-300">
                          Top 10 — {hasDelta ? 'Power & Gain' : 'Power Ranking'}
                        </h3>
                        {!hasDelta && (
                          <span className="text-[10px] text-slate-600 bg-white/5 px-2 py-1 rounded-full">
                            Single snapshot — delta = 0
                          </span>
                        )}
                      </div>
                      <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }} barCategoryGap="30%">
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" vertical={false} />
                            <XAxis
                              dataKey="name"
                              stroke="#475569"
                              fontSize={10}
                              tickLine={false}
                              axisLine={false}
                              tick={{ fill: '#64748b' }}
                            />
                            <YAxis
                              stroke="#475569"
                              fontSize={10}
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={fmt}
                              width={48}
                            />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', borderRadius: 8, fontSize: 12 }}
                              labelStyle={{ color: '#f59e0b', fontWeight: 700 }}
                              formatter={(value, name) => [fmt(value), name]}
                            />
                            <Bar dataKey="Power" name="Power" radius={[4, 4, 0, 0]} fill="#3b82f6" opacity={0.85} />
                            {hasDelta && (
                              <Bar dataKey="Power Gain" name="Power Gain Δ" radius={[4, 4, 0, 0]} fill="#10b981" opacity={0.9} />
                            )}
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )
                })()}

                {/* Single event leaderboard table */}
                <div className="glass-panel rounded-2xl overflow-hidden animate-fade-in stagger-2">
                  {lbLoading ? (
                    <div className="flex items-center justify-center py-20 text-slate-500"><RefreshCw size={18} className="animate-spin mr-2" />Loading...</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="premium-table">
                        <thead>
                          <tr>
                            <th className="px-4 py-3 text-left w-10">#</th>
                            <th className="px-4 py-3 text-left cursor-pointer hover:text-white" onClick={() => handleSort('player_name')}>
                              <span className="flex items-center gap-1">Player <SortIcon field="player_name" sortBy={sortBy} sortOrder={sortOrder} /></span>
                            </th>
                            <th className="px-4 py-3 text-left">Alliance</th>
                            <th className="px-4 py-3 text-right cursor-pointer hover:text-white" onClick={() => handleSort('end_might')}>
                              <span className="flex items-center justify-end gap-1">Power <SortIcon field="end_might" sortBy={sortBy} sortOrder={sortOrder} /></span>
                            </th>
                            <th className="px-4 py-3 text-right cursor-pointer hover:text-white" onClick={() => handleSort('net_might_gain')}>
                              <span className="flex items-center justify-end gap-1 text-amber-400">Power Δ <SortIcon field="net_might_gain" sortBy={sortBy} sortOrder={sortOrder} /></span>
                            </th>
                            <th className="px-4 py-3 text-right cursor-pointer hover:text-white" onClick={() => handleSort('end_kills')}>
                              <span className="flex items-center justify-end gap-1">Kill Points <SortIcon field="end_kills" sortBy={sortBy} sortOrder={sortOrder} /></span>
                            </th>
                            <th className="px-4 py-3 text-right cursor-pointer hover:text-white" onClick={() => handleSort('net_kills_gain')}>
                              <span className="flex items-center justify-end gap-1 text-amber-400">Kills Δ <SortIcon field="net_kills_gain" sortBy={sortBy} sortOrder={sortOrder} /></span>
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.04]">
                          {filteredLeaderboard.map((row, i) => (
                            <tr key={row.player_id} className="hover:bg-white/[0.03] transition-colors">
                              <td className="px-4 py-3 font-bold text-slate-500 text-xs">{i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td>
                              <td className="px-4 py-3 font-bold text-white">{row.player_name}</td>
                              <td className="px-4 py-3">
                                <span className="text-[10px] bg-white/5 border border-white/10 text-slate-400 font-bold px-2 py-0.5 rounded">{row.alliance || '—'}</span>
                              </td>
                              <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">{fmt(row.end_might)}</td>
                              <td className="px-4 py-3 text-right"><DeltaCell value={row.net_might_gain} /></td>
                              <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-300">{fmt(row.end_kills)}</td>
                              <td className="px-4 py-3 text-right"><DeltaCell value={row.net_kills_gain} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ══════════════════════════════════════════════
            TAB: PLAYERS (Admin only)
        ══════════════════════════════════════════════ */}
            {activeTab === 'players' && isAdmin && (
              <>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <h2 className="font-black text-base text-slate-200">Players <span className="text-slate-600 text-sm font-normal">({filteredPlayers.length})</span></h2>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowMergeModal(true)}
                      className="bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20 px-3 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
                    >
                      Merge Profiles
                    </button>
                    <select
                      className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                      value={filterKingdom}
                      onChange={e => setFilterKingdom(e.target.value)}
                    >
                      <option value="">All Kingdoms</option>
                      {uniqueKingdoms.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input type="text" placeholder="Search..." className="bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500/30 w-48" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                    </div>
                  </div>
                </div>

                <div className="glass-panel rounded-2xl overflow-hidden animate-fade-in stagger-3">
                  <table className="premium-table">
                    <thead>
                      <tr>
                        <th className="px-4 py-3 text-left">Name</th>
                        <th className="px-4 py-3 text-left">Alliance</th>
                        <th className="px-4 py-3 text-left">Kingdom</th>
                        <th className="px-4 py-3 text-left">Note</th>
                        <th className="px-4 py-3 text-left">Created</th>
                        <th className="px-4 py-3 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {filteredPlayers.map(player => (
                        <tr key={player.id} className="hover:bg-white/[0.03] transition-colors group">
                          {editingPlayer?.id === player.id ? (
                            <>
                              <td className="px-4 py-2"><input className="bg-slate-900 border border-amber-500/40 rounded px-2 py-1 text-sm w-full text-white" value={editingPlayer.name} onChange={e => setEditingPlayer({ ...editingPlayer, name: e.target.value })} /></td>
                              <td className="px-4 py-2"><input className="bg-slate-900 border border-white/10 rounded px-2 py-1 text-sm w-full text-slate-300" value={editingPlayer.alliance || ''} onChange={e => setEditingPlayer({ ...editingPlayer, alliance: e.target.value })} /></td>
                              <td className="px-4 py-2"><input className="bg-slate-900 border border-white/10 rounded px-2 py-1 text-sm w-full text-slate-300" value={editingPlayer.kingdom || ''} onChange={e => setEditingPlayer({ ...editingPlayer, kingdom: e.target.value })} /></td>
                              <td className="px-4 py-2"><input className="bg-slate-900 border border-white/10 rounded px-2 py-1 text-sm w-full text-slate-300" placeholder="e.g. farm alt" value={editingPlayer.note || ''} onChange={e => setEditingPlayer({ ...editingPlayer, note: e.target.value })} /></td>
                              <td className="px-4 py-2 text-slate-600 text-xs">{fmtDate(player.created_at)}</td>
                              <td className="px-4 py-2">
                                <div className="flex items-center justify-center gap-2">
                                  <button onClick={() => handleUpdatePlayer(editingPlayer)} className="p-1.5 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded-lg transition-colors"><Check size={13} /></button>
                                  <button onClick={() => setEditingPlayer(null)} className="p-1.5 bg-white/5 text-slate-400 hover:bg-white/10 rounded-lg transition-colors"><X size={13} /></button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-4 py-3 font-bold text-white">{player.name}</td>
                              <td className="px-4 py-3"><span className="text-[10px] bg-white/5 border border-white/10 text-slate-400 font-bold px-2 py-0.5 rounded">{player.alliance || '—'}</span></td>
                              <td className="px-4 py-3 text-slate-500 text-xs font-mono">{player.kingdom || '—'}</td>
                              <td className="px-4 py-3 text-slate-400 text-xs">{player.note || '—'}</td>
                              <td className="px-4 py-3 text-slate-600 text-xs">{fmtDate(player.created_at)}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => setEditingPlayer({ ...player })} className="p-1.5 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded-lg transition-colors"><Edit2 size={13} /></button>
                                  <button onClick={() => handleDeletePlayer(player.id)} className="p-1.5 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg transition-colors"><Trash2 size={13} /></button>
                                </div>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* ══════════════════════════════════════════════
            TAB: EVENTS (Admin only)
        ══════════════════════════════════════════════ */}
            {activeTab === 'events' && isAdmin && (
              <>
                {/* Create event form */}
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <PlusCircle size={16} className="text-amber-400" />
                    <h3 className="font-black text-sm text-amber-300 uppercase tracking-wide">Create New Event</h3>
                  </div>
                  <form onSubmit={handleCreateEvent} className="grid grid-cols-1 sm:grid-cols-6 gap-3 items-end">
                    <div className="sm:col-span-2">
                      <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider block mb-1">Event Name</label>
                      <input type="text" placeholder="e.g. KvK Round 1" required className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm w-full text-white focus:outline-none focus:ring-2 focus:ring-amber-500/40" value={newEvent.name} onChange={e => setNewEvent({ ...newEvent, name: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider block mb-1">Type</label>
                      <select className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm w-full text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/40" value={newEvent.event_type} onChange={e => setNewEvent({ ...newEvent, event_type: e.target.value })}>
                        <option value="standard">Standard Event</option>
                        <option value="campaign">KvK / Campaign</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider block mb-1">Parent Campaign (Optional)</label>
                      <select className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm w-full text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/40" value={newEvent.parent_id} onChange={e => setNewEvent({ ...newEvent, parent_id: e.target.value })} disabled={newEvent.event_type === 'campaign'}>
                        <option value="">— None —</option>
                        {events.filter(e => e.event_type === 'campaign').map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider block mb-1">Start Date</label>
                      <input type="datetime-local" required className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm w-full text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/40" value={newEvent.start_date} onChange={e => setNewEvent({ ...newEvent, start_date: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider block mb-1">End Date</label>
                      <input type="datetime-local" required className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm w-full text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/40" value={newEvent.end_date} onChange={e => setNewEvent({ ...newEvent, end_date: e.target.value })} />
                    </div>
                    <button type="submit" className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm px-4 py-2 rounded-lg transition-all active:scale-95 shadow sm:col-span-6 mt-2">
                      + Create Event
                    </button>
                  </form>
                </div>

                {/* Events table */}
                <div className="glass-panel rounded-2xl overflow-hidden animate-fade-in stagger-4">
                  <table className="premium-table">
                    <thead>
                      <tr>
                        <th className="px-4 py-3 text-left">Name</th>
                        <th className="px-4 py-3 text-left">Start Date</th>
                        <th className="px-4 py-3 text-left">End Date</th>
                        <th className="px-4 py-3 text-left">Created</th>
                        <th className="px-4 py-3 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {events.map(ev => (
                        <tr key={ev.id} className="hover:bg-white/[0.03] transition-colors group">
                          {editingEvent?.id === ev.id ? (
                            <>
                              <td className="px-4 py-2"><input className="bg-slate-900 border border-amber-500/40 rounded px-2 py-1 text-sm w-full text-white" value={editingEvent.name} onChange={e => setEditingEvent({ ...editingEvent, name: e.target.value })} /></td>
                              <td className="px-4 py-2"><input type="datetime-local" className="bg-slate-900 border border-white/10 rounded px-2 py-1 text-sm w-full text-slate-200" value={editingEvent.start_date?.slice(0, 16)} onChange={e => setEditingEvent({ ...editingEvent, start_date: e.target.value })} /></td>
                              <td className="px-4 py-2"><input type="datetime-local" className="bg-slate-900 border border-white/10 rounded px-2 py-1 text-sm w-full text-slate-200" value={editingEvent.end_date?.slice(0, 16)} onChange={e => setEditingEvent({ ...editingEvent, end_date: e.target.value })} /></td>
                              <td className="px-4 py-2 text-slate-600 text-xs">{fmtDate(ev.created_at)}</td>
                              <td className="px-4 py-2">
                                <div className="flex items-center justify-center gap-2">
                                  <button onClick={() => handleUpdateEvent(editingEvent)} className="p-1.5 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded-lg"><Check size={13} /></button>
                                  <button onClick={() => setEditingEvent(null)} className="p-1.5 bg-white/5 text-slate-400 hover:bg-white/10 rounded-lg"><X size={13} /></button>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className="px-4 py-3 font-bold text-white">{ev.name}</td>
                              <td className="px-4 py-3 text-slate-400 text-xs font-mono">{fmtDate(ev.start_date)}</td>
                              <td className="px-4 py-3 text-slate-400 text-xs font-mono">{fmtDate(ev.end_date)}</td>
                              <td className="px-4 py-3 text-slate-600 text-xs">{fmtDate(ev.created_at)}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => setEditingEvent({ ...ev })} className="p-1.5 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded-lg"><Edit2 size={13} /></button>
                                  <button onClick={() => handleDeleteEvent(ev.id)} className="p-1.5 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg"><Trash2 size={13} /></button>
                                </div>
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </main>

      {/* ── AUTH MODAL ── */}
      {showAuthModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-black text-white text-base">Admin Login</h3>
              <button onClick={() => setShowAuthModal(false)} className="text-slate-500 hover:text-white"><X size={18} /></button>
            </div>

            {authError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-400 flex items-start gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />{authError}
              </div>
            )}

            <form onSubmit={handleAuth} className="space-y-4">
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider block mb-1.5">Email</label>
                <input type="email" placeholder="admin@yourdomain.com" required className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2.5 w-full text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/40" value={authEmail} onChange={e => setAuthEmail(e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider block mb-1.5">Password</label>
                <input type="password" placeholder="••••••••" required className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2.5 w-full text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/40" value={authPassword} onChange={e => setAuthPassword(e.target.value)} />
              </div>
              <button type="submit" disabled={authLoading} className="w-full bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-black py-2.5 rounded-lg text-sm shadow transition-all active:scale-[0.98] disabled:opacity-60">
                {authLoading ? 'Signing in...' : 'Sign In as Admin'}
              </button>
            </form>

            <p className="text-[11px] text-slate-600 text-center">
              Admin access is granted via Supabase user metadata.<br />
              Contact your system administrator for credentials.
            </p>
          </div>
        </div>
      )}

      {/* Merge Players Modal */}
      {showMergeModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f172a] border border-white/10 rounded-2xl p-6 w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-black text-lg text-slate-200">Merge Player Profiles</h2>
              <button onClick={() => setShowMergeModal(false)} className="text-slate-500 hover:text-slate-300"><X size={18} /></button>
            </div>
            <p className="text-sm text-slate-400 mb-6 leading-relaxed">
              If a player used a renaming stone, the scraper created a new profile.
              Select the old name and the new name to merge them. <strong className="text-rose-400">The old profile will be deleted and its history moved to the new profile.</strong>
            </p>

            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Old Player Profile (Will be deleted)</label>
                <select
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
                  value={mergeOldPlayerId}
                  onChange={e => setMergeOldPlayerId(e.target.value)}
                >
                  <option value="">— Select old player name —</option>
                  {[...players].sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.alliance || 'No Alliance'})</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-center text-slate-600">
                <ArrowDown size={20} />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">New Player Profile (Will keep this name)</label>
                <select
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  value={mergeNewPlayerId}
                  onChange={e => setMergeNewPlayerId(e.target.value)}
                >
                  <option value="">— Select new player name —</option>
                  {[...players].sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.alliance || 'No Alliance'})</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-3 mt-4">
                <button onClick={() => setShowMergeModal(false)} className="px-4 py-2 text-sm font-bold text-slate-400 hover:text-white transition-colors">Cancel</button>
                <button
                  onClick={handleMergePlayers}
                  disabled={!mergeOldPlayerId || !mergeNewPlayerId}
                  className="px-4 py-2 bg-purple-500 hover:bg-purple-400 disabled:opacity-50 text-white text-sm font-bold rounded-lg transition-colors shadow-lg shadow-purple-500/20"
                >
                  Confirm Merge
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── FOOTER ── */}
      <footer className="border-t border-white/5 py-4 mt-4">
        <p className="text-center text-[11px] text-slate-700">
          © {new Date().getFullYear()} Viking Rise Clan Tracker — Powered by Supabase + OCR Automation
        </p>
      </footer>
    </div>
  )
}

export default App
