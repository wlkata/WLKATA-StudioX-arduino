/* Serial output is independent of compiler diagnostics and build logs. */
(function (root) {
  function create({get, request, api, getPort, isBusy, onChange}) {
    let state = {connected:false, port:'', baudrate:9600, error:''};
    let cursor = 0, revision = 0, pending = false, polling = false, disposed = false;
    let notice = '', pollError = '', action = '', resume = null;
    const baud = get('serial-baud'), output = get('serial-output');
    const text = document.createTextNode('');
    output.replaceChildren(text);
    const validBaud = value => Number.isInteger(value) && value >= 50 && value <= 4000000;
    const saved = Number(api.getSetting('arduino.serialBaud', 9600));
    baud.value = validBaud(saved) ? saved : 9600;

    function update() {
      get('serial-toggle').textContent = state.connected ? 'Disconnect' : 'Connect';
      get('serial-toggle').disabled = pending || (!state.connected && (isBusy() || !getPort()));
      baud.disabled = pending || isBusy();
      get('serial-clear').disabled = pending;
      get('serial-status').textContent = action || notice || pollError || state.error ||
        (state.connected ? 'Connected · ' + state.port + ' · ' + state.baudrate + ' baud' :
          resume ? 'Serial monitor paused for upload.' : 'Disconnected · ' + (getPort() || 'Choose a port in the toolbar.'));
      get('serial-status').dataset.error = String(!!(notice || pollError || state.error));
    }

    function apply(data) {
      const follow = output.scrollHeight - output.scrollTop - output.clientHeight < 40;
      if (data.reset) text.data = data.text || '';
      else if (data.text) text.appendData(data.text);
      if (text.length > 200000) text.deleteData(0, text.length - 200000);
      if (follow) output.scrollTop = output.scrollHeight;
      cursor = data.cursor;
      state = data;
      if (state.connected && document.activeElement !== baud) baud.value = state.baudrate;
      update();
    }

    async function poll() {
      if (disposed || polling || pending) return;
      polling = true;
      const current = revision;
      try {
        const data = await request('/serial/read', {cursor});
        if (!disposed && current === revision) { pollError = ''; apply(data); }
      } catch (error) {
        if (current === revision) { pollError = error.message; update(); }
      } finally { polling = false; }
    }

    async function change(message, work) {
      if (pending) throw Error('Wait for the serial operation to finish.');
      revision++;
      pending = true; action = message; notice = ''; pollError = '';
      update(); onChange();
      try {
        const data = await work();
        apply(data);
        return data;
      } catch (error) { notice = error.message; throw error; }
      finally { pending = false; action = ''; update(); onChange(); }
    }

    async function connect(port = getPort(), rate = Number(baud.value)) {
      if (!port) throw Error('Choose a serial port in the toolbar.');
      if (!validBaud(rate)) throw Error('Baud rate must be an integer from 50 to 4000000.');
      await change('Connecting…', () => request('/serial/connect', {port, baudrate:rate}));
      api.setSetting('arduino.serialBaud', rate);
      // A port selection may change while the connect request is in flight.
      await targetChanged();
    }

    const disconnect = () => change('Disconnecting…', () => request('/serial/disconnect', {}));
    function report(error) { notice = error.message; update(); }
    async function targetChanged() {
      if (pending) return;
      if (state.connected && state.port !== getPort()) {
        resume = null;
        try { await disconnect(); } catch (error) { report(error); }
      }
      update();
    }
    async function setBaud() {
      if (pending || isBusy()) return;
      const rate = Number(baud.value);
      if (!validBaud(rate)) throw Error('Baud rate must be an integer from 50 to 4000000.');
      notice = '';
      if (state.connected && rate !== state.baudrate) await connect(state.port, rate);
      else { api.setSetting('arduino.serialBaud', rate); update(); }
    }

    get('serial-toggle').addEventListener('click', () => {
      resume = null;
      (state.connected ? disconnect() : connect()).catch(report);
    });
    baud.addEventListener('change', () => setBaud().catch(report));
    baud.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); setBaud().catch(report); }
    });
    get('serial-clear').addEventListener('click', () => change('Clearing…', () => request('/serial/clear', {})).catch(report));

    const timer = setInterval(poll, 400);
    window.addEventListener('beforeunload', () => {
      disposed = true; clearInterval(timer);
      request('/serial/disconnect', {}, {keepalive:true}).catch(() => {});
    });
    update(); poll();
    return {
      update, targetChanged, transitioning:() => pending,
      pauseForUpload:async port => {
        if (pending) throw Error('Wait for the serial operation before uploading.');
        if (state.connected && state.port === port) {
          resume = {port, baudrate:state.baudrate};
          await disconnect();
        }
      },
      resumeAfterUpload:async () => {
        const previous = resume; resume = null;
        if (previous && previous.port === getPort() && !state.connected) {
          try { await connect(previous.port, previous.baudrate); } catch (error) { report(error); }
        }
        update();
      }
    };
  }
  root.StudioXArduinoSerialMonitor = {create};
})(typeof window !== 'undefined' ? window : globalThis);
