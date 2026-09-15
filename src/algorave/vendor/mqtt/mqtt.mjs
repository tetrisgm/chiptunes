/*
mqtt.mjs - for patterning the internet of things from strudel
Copyright (C) 2022 Strudel contributors - see <https://codeberg.org/uzu/strudel/src/branch/main/packages/serial/serial.mjs>
This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero General Public License for more details. You should have received a copy of the GNU Affero General Public License along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { Pattern, logger } from '@strudel/core';
import Paho from '../paho-mqtt/paho-mqtt.js';

const connections = new Map();
const pending = new Set();
let generation = 0;
export function closeMqtt() {
  generation++;
  for (const timer of pending) clearTimeout(timer);
  pending.clear();
  for (const cx of connections.values()) {
    try { cx.disconnect(); } catch (_) { /* Already disconnected. */ }
  }
  connections.clear();
}
if (typeof window !== 'undefined') {
  window.addEventListener('message', event => {
    if (event.source === window && event.data === 'strudel-stop') closeMqtt();
  });
  window.addEventListener('pagehide', closeMqtt);
}

Pattern.prototype.mqtt = function (
  username = undefined,
  password = undefined,
  topic = undefined,
  host = 'wss://localhost:8883/',
  client = undefined,
  latency = 0,
  add_meta = true,
) {
  const key = host + '-' + client;
  const started = generation;
  let cx = connections.get(key);
  if (!cx) {
    if (username && typeof password === 'undefined') {
      throw Error('MQTT: supply the broker password as the second mqtt argument.');
    }
    if (!client) client = 'strudel-' + String(Math.floor(Math.random() * 1000000));
    cx = new Paho.Client(host, client);
    connections.set(key, cx);
    const forget = () => { if (connections.get(key) === cx) connections.delete(key); };
    cx.onConnectionLost = response => {
      forget();
      if (response.errorCode && started === generation) logger('MQTT connection lost', 'error');
    };
    const props = {
      onSuccess: () => {
        if (started !== generation) { try { cx.disconnect(); } catch (_) {} }
      },
      onFailure: () => { forget(); if (started === generation) logger('MQTT connection failed', 'error'); },
      useSSL: true,
    };
    if (username) { props.userName = username; props.password = password; }
    try { cx.connect(props); } catch (error) { forget(); throw error; }
  }
  return this.withHap((hap) => {
    const onTrigger = (hap, currentTime, cps, targetTime) => {
      let msg_topic = topic;
      if (started !== generation || !cx || !cx.isConnected()) {
        return;
      }
      let message = '';
      if (typeof hap.value === 'object') {
        let value = hap.value;

        // Try to take topic from pattern if it's not set
        if (typeof msg_topic === 'undefined' && 'topic' in value) {
          msg_topic = value.topic;
          if (Array.isArray(msg_topic)) {
            msg_topic = msg_topic.join('/');
          }
          msg_topic = '/' + msg_topic;
        }
        if (add_meta) {
          const duration = hap.duration.div(cps);
          value = { ...value, duration: duration.valueOf(), cps: cps };
        }
        message = JSON.stringify(value);
      } else {
        message = hap.value;
      }
      message = new Paho.Message(message);
      message.destinationName = msg_topic;

      const offset = (targetTime - currentTime + latency) * 1000;

      const timer = window.setTimeout(function () {
        pending.delete(timer);
        if (started !== generation || !cx.isConnected()) return;
        try { cx.send(message); } catch (_) { logger('MQTT message could not be sent', 'error'); }
      }, offset);
      pending.add(timer);
    };
    return hap.setContext({ ...hap.context, onTrigger, dominantTrigger: true });
  });
};
