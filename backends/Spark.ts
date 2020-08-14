import RNFetchBlob from 'rn-fetch-blob';
import stores from '../stores/Stores';
import TransactionRequest from './../models/TransactionRequest';
import OpenChannelRequest from './../models/OpenChannelRequest';

// keep track of all active calls so we can cancel when appropriate
const calls: any = {};

export class Spark {
    rpc = (rpcmethod, params = {}, range = null) => {
        let { url, accessKey, certVerification } = stores.settingsStore;

        const id = rpcmethod + JSON.stringify(params) + JSON.stringify(range);
        if (calls[id]) {
            return calls[id];
        }

        url = url.slice(-4) === '/rpc' ? url : url + '/rpc';

        const headers = { 'X-Access': accessKey };
        if (range) {
            headers['Range'] = `${range.unit}=${range.slice}`;
        }

        calls[id] = RNFetchBlob.config({
            trusty: !certVerification
        })
            .fetch(
                'POST',
                url,
                headers,
                JSON.stringify({ method: rpcmethod, params: params })
            )
            .then(response => {
                delete calls[id];
                const status = response.info().status;
                if (status < 300) {
                    return response.json();
                } else {
                    var errorInfo;
                    try {
                        errorInfo = response.json();
                    } catch (err) {
                        throw new Error(
                            'response was (' + status + ')' + response.text()
                        );
                    }
                    throw new Error(errorInfo.message);
                }
            });

        return calls[id];
    };

    getTransactions = () =>
        this.rpc('listfunds').then(({ outputs }) => ({
            transactions: outputs
        }));
    getChannels = () =>
        this.rpc('listpeers').then(({ peers }) => ({
            channels: peers
                .filter(peer => peer.channels.length)
                .map(peer => {
                    let channel =
                        peer.channels.find(
                            c => c.state !== 'ONCHAIN' && c.state !== 'CLOSED'
                        ) || peer.channels[0];

                    return {
                        active: peer.connected,
                        remote_pubkey: peer.id,
                        channel_point: channel.funding_txid,
                        chan_id: channel.channel_id,
                        capacity: Number(
                            channel.msatoshi_total / 1000
                        ).toString(),
                        local_balance: Number(
                            channel.msatoshi_to_us / 1000
                        ).toString(),
                        remote_balance: Number(
                            (channel.msatoshi_total - channel.msatoshi_to_us) /
                                1000
                        ).toString(),
                        total_satoshis_sent: Number(
                            channel.out_msatoshi_fulfilled / 1000
                        ).toString(),
                        total_satoshis_received: Number(
                            channel.in_msatoshi_fulfilled / 1000
                        ).toString(),
                        num_updates: (
                            channel.in_payments_offered +
                            channel.out_payments_offered
                        ).toString(),
                        csv_delay: channel.our_to_self_delay,
                        private: channel.private,
                        local_chan_reserve_sat: channel.our_channel_reserve_satoshis.toString(),
                        remote_chan_reserve_sat: channel.their_channel_reserve_satoshis.toString(),
                        close_address: channel.close_to_addr
                    };
                })
        }));
    getBlockchainBalance = () =>
        this.rpc('listfunds').then(({ outputs }) => {
            const unconf = outputs
                .filter(o => o.status !== 'confirmed')
                .reduce((acc, o) => acc + o.value, 0);
            const conf = outputs
                .filter(o => o.status === 'confirmed')
                .reduce((acc, o) => acc + o.value, 0);

            return {
                total_balance: conf + unconf,
                confirmed_balance: conf,
                unconfirmed_balance: unconf
            };
        });
    getLightningBalance = () =>
        this.rpc('listfunds').then(({ channels }) => ({
            balance: channels
                .filter(o => o.state === 'CHANNELD_NORMAL')
                .reduce((acc, o) => acc + o.channel_sat, 0),
            pending_open_balance: channels
                .filter(o => o.state === 'CHANNELD_AWAITING_LOCKIN')
                .reduce((acc, o) => acc + o.channel_sat, 0)
        }));
    sendCoins = (data: TransactionRequest) =>
        this.rpc('withdraw', {
            desination: data.addr,
            feerate: `${Number(data.sat_per_byte) * 1000}perkb`,
            satoshi: data.amount
        });
    getMyNodeInfo = () => this.rpc('getinfo');
    getInvoices = () =>
        this.rpc('listinvoices', {}, { unit: 'invoices', slice: '-100' }).then(
            ({ invoices }) => ({
                invoices: invoices.map(inv => ({
                    memo: inv.description,
                    r_preimage: inv.payment_preimage,
                    r_hash: inv.payment_hash,
                    value: parseInt(inv.msatoshi / 1000),
                    value_msat: inv.msatoshi,
                    settled: inv.status === 'paid',
                    creation_date: inv.expires_at,
                    settle_date: inv.paid_at,
                    payment_request: inv.bolt11,
                    expiry: inv.expires_at,
                    amt_paid: parseInt(inv.msatoshi_received / 1000),
                    amt_paid_sat: parseInt(inv.msatoshi_received / 1000),
                    amt_paid_msat: inv.msatoshi_received
                }))
            })
        );
    createInvoice = (data: any) =>
        this.rpc('invoice', {
            description: data.memo,
            label: 'zeus.' + parseInt(Math.random() * 1000000),
            msatoshi: Number(data.value) * 1000,
            expiry: data.expiry,
            exposeprivatechannels: true
        });
    getPayments = () =>
        this.rpc('listsendpays', {}, { unit: 'payments', slice: '-100' });
    getNewAddress = () => this.rpc('newaddr');
    openChannel = (data: OpenChannelRequest) =>
        this.rpc('fundchannel', {
            id: data.node_pubkey_string,
            amount: data.satoshis,
            feerate: `${Number(data.sat_per_byte) * 1000}perkb`,
            announce: !data.private
        }).then(({ txid }) => ({ funding_txid_str: txid }));
    connectPeer = (data: any) =>
        this.rpc('connect', [data.addr.pubkey, data.addr.host]);
    listNode = () => {};
    decodePaymentRequest = (urlParams?: Array<string>) =>
        this.rpc('decodepay', [urlParams[0]]);
    payLightningInvoice = (data: any) =>
        this.rpc('pay', {
            bolt11: data.payment_request,
            msatoshi: data.amt ? Number(data.amt * 1000) : undefined
        });
    closeChannel = (urlParams?: Array<string>) =>
        this.rpc('close', {
            id: urlParams[0],
            unilateraltimeout: urlParams[1] ? 60 : 0
        }).then(() => ({ chan_close: { success: true } }));
    getNodeInfo = (urlParams?: Array<string>) =>
        this.rpc('listnodes', [urlParams[0]]).then(({ nodes }) => {
            const node = nodes[0];
            return {
                node: node && {
                    last_update: node.last_timestamp,
                    pub_key: node.nodeid,
                    alias: node.alias,
                    color: node.color,
                    addresses: node.addresses.map(addr => ({
                        network: 'tcp',
                        addr:
                            addr.type === 'ipv6'
                                ? `[${addr.address}]:${addr.port}`
                                : `${addr.address}:${addr.port}`
                    }))
                }
            };
        });
    getFees = async () => {
        const info = await this.rpc('getinfo');

        const [listforwards, listpeers, listchannels] = await Promise.all([
            this.rpc('listforwards'),
            this.rpc('listpeers'),
            this.rpc('listchannels', { source: info.id })
        ]);

        let lastDay, lastWeek, lastMonth;
        const now = parseInt(new Date().getTime() / 1000);
        const oneDayAgo = now - 60 * 60 * 24;
        const oneWeekAgo = now - 60 * 60 * 24 * 7;
        const oneMonthAgo = now - 60 * 60 * 24 * 30;
        for (let i = listforwards.forwards.length - 1; i >= 0; i--) {
            const forward = listforwards.forwards[i];
            if (forward.status !== 'settled') continue;
            if (forward.resolved_time > oneDayAgo) {
                lastDay += forward.fee;
                lastWeek += forward.fee;
                lastMonth += forward.fee;
            } else if (forward.resolved_time > oneWeekAgo) {
                lastWeek += forward.fee;
                lastMonth += forward.fee;
            } else if (forward.resolved_time > oneWeekAgo) {
                lastMonth += forward.fee;
            } else break;
        }

        const channels = {};
        for (let i = 0; i < listchannels.channels.length; i++) {
            const channel = listchannels.channels[i];
            channels[channel.short_channel_id] = {
                base_fee_msat: channel.base_fee_millisatoshi,
                fee_rate: channel.fee_per_millionth / 1000000
            };
        }

        return {
            channel_fees: listpeers
                .filter(({ channels }) => channels && channels.length)
                .map(
                    ({
                        channels: [
                            { short_channel_id, channel_id, funding_txid }
                        ]
                    }) => ({
                        chan_id: channel_id,
                        channel_point: funding_txid,
                        base_fee_msat:
                            channels[short_channel_id].base_fee_milli,
                        fee_rate: channels[short_channel_id].fee_rate
                    })
                ),
            total_fee_sum: parseInt(info.msatoshi_fees_collected / 1000),
            day_fee_sum: parseInt(lastDay / 1000),
            week_fee_sum: parseInt(lastWeek / 1000),
            month_fee_sum: parseInt(lastMonth / 1000)
        };
    };
    setFees = (data: any) =>
        this.rpc('setchannelfee', {
            id: data.global ? 'all' : data.channelId,
            base: data.base_fee_msat,
            ppm: data.fee_rate * 1000000
        });
    getRoutes = async (urlParams?: Array<string>) => {
        const msatoshi = Number(urlParams[1]) * 1000;

        const res = await this.rpc('getroute', {
            id: urlParams[0],
            msatoshi,
            riskfactor: 2
        });

        const route = res.route[0];

        return {
            routes: [
                {
                    total_fees: parseInt((route[0].msatoshi - msatoshi) / 1000)
                }
            ]
        };
    };

    supportsOnchainSends = () => true;
    supportsKeysend = () => false;
    supportsChannelManagement = () => true;
    supportsCustomHostProtocol = () => false;
    supportsMPP = () => false;
}
