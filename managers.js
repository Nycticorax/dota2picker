const key = '75DDC532A6404AEA5AC7091A33ED1AF9'
const { db } = require('./server_autofetch/firebase/firebase.js')
const axios = require('axios')

var Obs = {
    subscribed: [],
    subscribe(caller, ...funs) {
        for (let f of funs) {
            this.subscribed.push({
                name: f.name,
                calls: 0
            })
            caller[f.name] = this.wrap(caller, caller[f.name])
        }
    },
    unsubscribe(f) {
        this.subscribed.filter(item => !item.name === f.name)
    },
    upCalls(f_name) {
        let i = this.subscribed.findIndex(item => item.name === f_name)
        this.subscribed[i].calls++
    },
    wrap(caller, f) {
        return (...args) => {
            console.log('Just called ' + f.name)
            this.upCalls(f.name)
            try {
                if (f.constructor.name === 'AsyncFunction') {
                    return f.apply(caller, args).then(res => {
                        this.db_logger('Resolved', f.name)
                        return res
                    })
                }
                else throw new Error('Not async or then-able')
            } catch (error) { this.db_logger('Failed: ' + f.name, error) }
        }
    },
    db_logger: async function (caller, msg) {
        if (!Utils.isJson(msg)) msg = JSON.stringify(msg)
        let refTime = Utils.putDate()
        let doc = await db.collection('logs').doc(refTime).get()
        if (doc.exists) {
            await db.collection('logs').doc(refTime).collection('logs').doc(Date()).set({
                [caller]: msg
            })
        }
        else {
            await db.collection('logs').doc(Utils.putDate()).set({
                [caller]: msg
            })
        }
    }
}

var Utils = {
    isJson(str) {
        try {
            JSON.parse(str)
        } catch (e) {
            return false
        }
        return true
    },
    putDate() {
        let today = new Date()
        let dd = String(today.getDate()).padStart(2, '0')
        let mm = String(today.getMonth() + 1).padStart(2, '0')
        let yyyy = today.getFullYear();
        today = dd + '_' + mm + '_' + yyyy;
        return today
    },
    wlb_95(positive, negative) {
        return ((positive + 1.9208) / (positive + negative) - 1.96 * Math.sqrt((positive * negative) / (positive + negative) + 0.9604) / (positive + negative)) / (1 + 3.8416 / (positive + negative))
    },
    round(n) {
        return Math.round(n * 100) / 100
    },
    objectify(arr_of_arr) {
        let arr = []
        for (let i of arr_of_arr) {
            let res = {}
            res[Number(i[0])] = i[1]
            arr.push(res)
        }
        return arr
    },
    flatten(arr) {
        return [].concat(...arr)
    },
    makeUnique(matchesIds) {
        let unique = []
        for (let matchId of matchesIds) {
            if (!unique.includes(matchId)) unique.push(matchId)
        }
        return unique
    },
    cutLast2000(matchesIds) {
        return matchesIds.slice(-2000)
    },
    partitionForBatches(arr, padding) {
        let res = []
        for (let i = 0; i < arr.length; i += padding) {
            res[res.length] = arr.slice(i, i + padding)
        }
        return res
    }

}

var MDetails = {
    init() {
        Obs.subscribe(this, this.steam_fetch, this.db_fetch, this.db_save)
    },
    db_fetch: async function (slice_nb = 3) {
        let ref_slices = db.collection('slice_matches_details')
        let last_slices = await ref_slices.orderBy('created', 'desc').limit(3).get()
        let slicesIds = last_slices.docs.map(doc => doc.id)
        let data = []
        for (let sliceId of slicesIds) {
            let slice = await ref_slices.doc(sliceId).collection('slice').get()
            data.push(slice.docs.map(doc => doc.data()))
        }
        let res = data.reduce((a, b) => a.concat(b))
        return res
    },
    db_save: async function (matchesDetails, slice = false) { // 'async' for observer
        let ref = slice ? db.collection('slice_matches_details').doc(this.putDate()).collection('slice') : db.collection('matches_details')
        let partitions = this.partitionForBatches(matchesDetails, 500)
        return Promise.all(partitions.map(part => {
            let batch_part = db.batch()
            part.forEach(match => {
                batch_part.set(ref.doc(match.id.toString()), {
                    id: match.id,
                    duration: match.duration,
                    won: match.won,
                    picks: match.picks,
                    radiant: match.radiant,
                    dire: match.dire,
                    bans: match.bans
                })
            })
            return batch_part.commit().catch(e => { throw new Error(e) })//.then(() => db.collection('slice_matches_details').doc(putDate()).update({'when': new Date()}))
        }))
            .then(() => {
                if (slice) return db.collection('slice_matches_details').doc(this.putDate()).set({ 'created': new Date() })
                else return;
            })
            .catch(err => 'db_addMatchesDetailsSlice: Failed for this reason: ' + err)
    },/*
    steam_fetch_test: async function() {
        let qString = 'https://api.steampowered.com/IDOTA2Match_570/GetMatchDetails/v1/?key=75DDC532A6404AEA5AC7091A33ED1AF9&match_id=5070271192'
        res = await axios.get(qString)
        data = res.data.result
        return {
            winner: data['radiant_win'],
            duration: data['duration'],
            picks: data['players'].map(player => player['hero_id'])
        }
    },*/
    steam_fetch: async function (heroes) {
        async function* matchesGen(heroId) {
            heroId = heroId.toString()
            let qString = `https://api.steampowered.com/IDOTA2Match_570/GetMatchHistory/v1/?hero_id=${heroId}&game_mode=1&skill=3&min_players=10&key=${key}`
            let remaining = 500
            while (remaining > 0) {
                const res = await axios.get(qString)
                const matchesIds = res.data.result.matches.map(match => match["match_id"])
                let nextId = matchesIds[matchesIds.length - 1] - 1
                remaining = res.data.result.results_remaining
                qString = `https://api.steampowered.com/IDOTA2Match_570/GetMatchHistory/v1/?hero_id=${heroId}&start_at_match_id=${nextId}&game_mode=1&skill=3&min_players=10&key=${key}`
                yield matchesIds
            }
        }
        async function* detailsGen(matchesIds) {
            let done = 0, remaining = null
            for (let matchId of matchesIds) {
                matchId = matchId.toString()
                const qString = `https://api.steampowered.com/IDOTA2Match_570/GetMatchDetails/v1/?key=${key}&match_id=${matchId}`
                const res = await axios.get(qString)
                let data;
                if (typeof (res.data) === 'undefined') { console.log(qString); return }
                else data = res.data.result
                let won;
                if (data["radiant_win"] === true) won = "radiant"
                else won = "dire"
                let picks = [], radiant = [], dire = [], bans = []
                for (let [key, player] of data["players"].entries()) {
                    picks.push(player["hero_id"])
                    if (key < 5) radiant.push(player["hero_id"])
                    else dire.push(player["hero_id"])
                }
                if (data["picks_bans"]) {
                    for (let ban of data["picks_bans"]) {
                        bans.push(ban["hero_id"])
                    }
                }
                done++
                remaining = matchesIds.length - done
                console.log(`Fetching match: ${matchId}, ${remaining} remaining. (Expecting about ${remaining / 60} minutes.)`)
                yield {
                    id: data["match_id"],
                    duration: data["duration"],
                    won: won,
                    picks: picks,
                    radiant: radiant,
                    dire: dire,
                    bans: bans
                }
            }
        }
        const consumeMatchesGen = async (heroes) => { // scope = array of Objs with id: Int representing Dota 2 heroes
            let matchesIds = [], matchesCounter
            for (let hero of heroes) {
                matchesCounter = 0
                for await (let hero_matchesIds of matchesGen(hero.id)) {
                    matchesIds.push(hero_matchesIds)
                    matchesCounter += hero_matchesIds.length
                }
                let curr = heroes.find(h => h.id === hero.id)
                console.log(`Done fetching ${matchesCounter} for: ${curr.name}`)
                if (matchesCounter < 400) heroes.push({ name: curr.name, id: hero.id })
            }
            console.log(`Done fetching ${matchesIds.length} for all heroes.`)
            return this.flatten(matchesIds)
        }
        const consumeDetailsGen = async (matchesIds) => {
            let matchesDetails = []
            for await (let match_details of detailsGen(matchesIds)) {
                matchesDetails.push(match_details)
            }
            return matchesDetails
        }
        const handler = async (heroes) => {
            let matchesIds = await consumeMatchesGen(heroes)
            matchesIds = this.cutLast2000(this.makeUnique(this.flatten(matchesIds)))
            return await consumeDetailsGen(matchesIds)
        }
        return await handler(heroes)
    }
}

var Scores = {
    scorePayload: {},
    init: async function () {
        Obs.subscribe(this, this.db_fetch, this.db_save)
        await this.refresh()
    },
    get: async function () {
        return await this.scorePayload
    },
    refresh: async function (scores = null) {
        if (scores) {
            this.scorePayload.scores = scores
            this.scorePayload.last = (() => {
                let today = new Date()
                let dd = today.getDate()
                let mm = today.getMonth() + 1
                let yyyy = today.getFullYear()
                if (dd < 10) dd = '0' + dd
                if (mm < 10) mm = '0' + mm
                return dd + '_' + mm + '_' + yyyy
            })()
        }
        else this.scorePayload = await this.db_fetch()
    },
    make_scores_from_matches_details: async function(heroes, limit_value=6000){
        let data = await db.collection('matches_details').limit(limit_value).get()
        let matches_details = data.docs.map(doc => doc.data())
        return this.make(heroes, matches_details)
    },
    db_fetch: async function () {
        let ref_slices = db.collection('slice_heroes')
        let last_slice = await ref_slices.orderBy('created', 'desc').limit(1).get()
        last_slice = last_slice.docs.map(doc => doc.id)[0]
        let heroes = await ref_slices.doc(last_slice).collection('slice').get()
        let data = []
        for (let heroDoc of heroes.docs) {
            data.push(heroDoc.data())
        }
        return { scores: data, last: last_slice }
    },
    make(heroes, matches_details) {
        let heroesStats = heroes.map(hero => {
            // fillers before receiving stats
            let bestVs = {},
                bestWith = {}
            for (let h of heroes) {
                if (h.id !== hero.id) {
                    // bestVs, bestWith
                    bestVs[h.id] = {
                        played: 0,
                        wins: 0
                    }
                    bestWith[h.id] = {
                        played: 0,
                        wins: 0
                    }
                }
            }
            return {
                id: hero.id,
                name: hero.name,
                played: 0,
                wins: 0,
                pickRate: 0,
                winRate: 0,
                wilsonAbsScore: 0,
                avgWinDuration: 0,
                dTier1: 0,
                dTier2: 0,
                dTier3: 0,
                dTier4: 0,
                bestVs: bestVs,
                bestWith: bestWith,
                pickWith: [],
                pickVs: []
            }
        })
        //  duration
        let totalDuration = 0
        for (let match of matches_details) {
            totalDuration += match['duration']
        }
        totalDuration = this.round(totalDuration / matches_details.length)
        let dTier1 = totalDuration * 1 / 2,
            dTier2 = totalDuration * 2 / 3,
            dTier3 = totalDuration * 3 / 2
        // collecting stats
        for (let match of matches_details) {
            let winner = match['won'],
                sides = ['radiant', 'dire']
            let loser = winner === 'radiant' ? 'dire' : 'radiant'
            //picks
            for (let id of match['picks']) {
                let curr = heroesStats.findIndex(h => h.id === id)
                heroesStats[curr]['played']++
                if (match[winner].includes(id)) {
                    //wins, avgWinduration, duration tiers
                    heroesStats[curr]['wins']++
                    heroesStats[curr]['avgWinDuration'] += match['duration']
                    if (match['duration'] < dTier1) heroesStats[curr]['dTier1']++
                    if (match['duration'] > dTier1 && match['duration'] < dTier2) heroesStats[curr]['dTier2']++
                    if (match['duration'] > dTier2 && match['duration'] < dTier3) heroesStats[curr]['dTier3']++
                    if (match['duration'] > dTier3) heroesStats[curr]['dTier4']++
                    //bestVs, bestWith
                    for (let friend of match[winner]) {
                        if (friend !== id) {
                            heroesStats[curr]['bestWith'][friend]['played']++
                            heroesStats[curr]['bestWith'][friend]['wins']++
                        }
                    }
                    for (let foe of match[loser]) {
                        heroesStats[curr]['bestVs'][foe]['played']++
                        heroesStats[curr]['bestVs'][foe]['wins']++
                    }
                } else {
                    for (let friend of match[loser]) {
                        if (friend !== id) heroesStats[curr]['bestWith'][friend]['played']++
                    }
                    for (let foe of match[winner]) {
                        heroesStats[curr]['bestVs'][foe]['played']++
                    }
                }
            }
        }
        // computing winRates, pickRates, wilsonAbsScore, avgWinDuration mean, this.rounding
        for (let hero of heroesStats) {
            let bestEnemies = [],
                bestFriends = []
            hero['winRate'] = this.round(hero['wins'] / hero['played'])
            hero['pickRate'] = this.round(hero['played'] / matches_details.length)
            hero['wilsonAbsScore'] = this.round(this.wlb_95(hero['wins'], hero['played'] - hero['wins']))
            // MISSING RATIO TO WEIGH WILSON ABS SCORE WITH PICKRATE
            hero['avgWinDuration'] = this.round(hero['avgWinDuration'] / hero['played'])
            for (let foe in hero['bestVs']) {
                let wins = hero['bestVs'][foe]['wins'],
                    played = hero['bestVs'][foe]['played']
                if (played > 0) {
                    hero['bestVs'][foe]['winRate'] = this.round(wins / played)
                    hero['bestVs'][foe]['wilsonRelScore'] = this.round(this.wlb_95(wins, played - wins))
                    bestEnemies.push([foe, hero['bestVs'][foe]])
                }
            }
            for (let friend in hero['bestWith']) {
                let wins = hero['bestWith'][friend]['wins'],
                    played = hero['bestWith'][friend]['played']
                if (played > 0) {
                    hero['bestWith'][friend]['winRate'] = this.round(wins / played)
                    hero['bestWith'][friend]['wilsonRelScore'] = this.round(this.wlb_95(wins, played - wins))
                    bestFriends.push([friend, hero['bestWith'][friend]])
                }
            }
            hero['pickVs'] = this.objectify(bestEnemies.sort((a, b) => b[1]['wilsonRelScore'] - a[1]['wilsonRelScore']).slice(0, 5))
            hero['pickWith'] = this.objectify(bestFriends.sort((a, b) => b[1]['wilsonRelScore'] - a[1]['wilsonRelScore']).slice(0, 5))
        }
        return heroesStats
    },
    db_save: async function (scores) {
        let batch = db.batch()
        scores.forEach(hero => {
            let heroDoc = db.collection('slice_heroes').doc(this.putDate()).collection('slice').doc(hero.id.toString())
            batch.set(heroDoc, {
                id: hero.id,
                name: hero.name,
                played: hero.played,
                wins: hero.wins,
                pickRate: hero.pickRate,
                winRate: hero.winRate,
                wilsonAbsScore: hero.wilsonAbsScore,
                avgWinDuration: hero.avgWinDuration,
                dTier1: hero.dTier1,
                dTier2: hero.dTier2,
                dTier3: hero.dTier3,
                dTier4: hero.dTier4,
                bestVs: hero.bestVs,
                bestWith: hero.bestWith,
                pickVs: hero.pickVs,
                pickWith: hero.pickWith
            })
        })
        return batch.commit().catch(err => { throw new Error('db_save scores: Failed for this reason: ' + err) })
            .then(() => db.collection('slice_heroes').doc(this.putDate()).set({ 'created': new Date() }))
    }
}

const Tools = {
    spot_incomplete_slices: async function () {
        // returns object { faulty, clean } listing score slices with incomplete data & score slices with complete data
        const check_slices = async function* (slices_ids) {
            for (let slice_id of slices_ids) {
                let slice_docs = await db.collection('slice_heroes').doc(slice_id).collection('slice').get()
                let faulty = slice_docs.docs.filter(doc => {
                    for (let k in doc.data()) {
                        if (doc.data()[k] === 0) return true
                    }
                }).map(doc => doc.id)
                yield { slice: slice_id, faulty_heroes: faulty }
            }
        }
        const review_faulty = async (slices_ids) => {
            let faults = []
            for await (let faulty of check_slices(slices_ids)) {
                faults.push(faulty)
            }
            let faulty_slices = faults.map(f => f.slice)
            let clean = slices_ids.filter(slice_id => !faulty_slices.includes(slice_id))
            return { faulty: faults, clean: clean }
        }
        let slices = await db.collection('slice_heroes').get()
        let slices_ids = slices.docs.map(doc => doc.id)
        return await review_faulty(slices_ids)
    },
    enumerate_heroes_occurrences: async function (limit_nb=5000) {
        // returns various stats about collected matches details, such the number of occurrences of each individual hero
        const fetch_picks = function* (matches_data){
            for (let match of matches_data){
                yield match.picks
            }
        }
        const count_picks = function(matches_ids){
            let heroes_stats = {}
            for (let one_game_picks of fetch_picks(matches_data)){
                one_game_picks.forEach(p => {
                    if (p in heroes_stats) heroes_stats[p]++
                    else heroes_stats[p] = 1
                })
            }
            return heroes_stats
        }
        let matches = await db.collection('matches_details').limit(limit_nb).get()
        let matches_data = matches.docs.map(doc => doc.data())
        return count_picks(matches_data)
    },
    delete_collection: async function(collName, batchSize=6000){
        const deleteQueryBatch = (query, batchSize, resolve, reject) => {
            query.get()
            .then((snapshot) => {
                // When there are no documents left, we are done
                if (snapshot.size == 0) {
                    return 0;
            }

            // Delete documents in a batch
            let batch = db.batch();
            snapshot.docs.forEach((doc) => {
                batch.delete(doc.ref);
            });

            return batch.commit().then(() => {
                return snapshot.size;
            });
            }).then((numDeleted) => {
            if (numDeleted === 0) {
                resolve();
                return;
            }
            // Recurse on the next process tick, to avoid
            // exploding the stack.
            process.nextTick(() => {
                deleteQueryBatch(db, query, batchSize, resolve, reject);
            });
            })
            .catch(reject);
        }
        let query = db.collection(collName).orderBy('__name__').limit(batchSize)
        return new Promise((resolve, reject) => {
            deleteQueryBatch(query, batchSize, resolve, reject)
        })
    }
}


const details_manager = Object.assign(Object.create(MDetails), Utils)
const scores_manager = Object.assign(Object.create(Scores), Utils)
const tools = Object.create(Tools)

module.exports = { details_manager, scores_manager, tools }
