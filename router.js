const axios = require('axios')
const express = require('express')
const router = express.Router()
const key = '75DDC532A6404AEA5AC7091A33ED1AF9'
//const { scores_manager } = require ('./managers.js')
const scores = require('./server_autofetch/scores.json')

/*const startRouter = (async () => {
    await scores_manager.init()
    let res = await scores_manager.get()
    console.log('Router.js: Scores Manager online. Last slice: ', res.last)
})()*/

/*
router.get('/scores', async function (req, res) {
    res.send(await scores_manager.get())
})
*/
router.get('/scores', function (req, res) {
    res.send({scores:scores, last:'17/10/2019'})
})

router.get('/match/:matchId', async function (req, res) {
    try {
        let id = req.params.matchId
        console.log('pickerRoutes: Sending request with ', id)
        let result = await getMatchDetails(id)
        console.log('pickerRoutes: Received result ', result)
        res.send(result)
    } catch (e) {
        console.error('from router/match', e)
    }
})

async function getMatchDetails(id) {
    qString = `https://api.steampowered.com/IDOTA2Match_570/GetMatchDetails/v1/?match_id=${id}&key=${key}`
    console.log('getMatchDetails: calling valve with ', id)
    let res = await axios.get(qString)
    console.log('getMatchDetails: got from valve: ', res)
    res = res.data.result
    let radiant = [], dire = []
    for (let [key, player] of res['players'].entries()) {
        if (key < 5) radiant.push(player['hero_id'])
        else dire.push(player['hero_id'])
    }
    return { radiant: radiant, dire: dire }
}

module.exports = router