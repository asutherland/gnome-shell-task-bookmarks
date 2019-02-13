function extractClientId(prefixed) {
  return prefixed.split(':', 1)[0];
}

function extractUnprefixedContainerId(prefixed) {
  // propagate null/undefined, don't explode.
  if (!prefixed) {
    return prefixed;
  }
  const idxColon = prefixed.indexOf(':');
  return prefixed.substring(idxColon + 1);
}

class BrainBoss {
  constructor({ debugStateUpdated }) {
    this.clientsByPrefix = new Map();
    /**
     * Map from capability string to a list of resolve functions to invoke with
     * a conn when it shows up.
     */
    this.awaitingClientsByCapability = new Map();

    // This is a method that gets clobbered in shortly after we're creating.
    // See ModeDispatcher.notifyModes.
    this.notifyModes = null;

    this.debugStateUpdated = debugStateUpdated;
  }

  renderDebugState() {
    const rows = [];
    for (const brainConn of this.clientsByPrefix.values()) {
      rows.push([
        brainConn.clientType,
        brainConn.clientName,
        brainConn.clientUniqueId
      ]);
    }
    return {
      headers: ['Type', 'Name', 'UniqueId'],
      data: rows
    };
  }

  registerClient(brainConn, msg) {
    const idPrefix = `${msg.type}_-_${msg.name}_-_${msg.uniqueId}:`;
    const barePrefix = idPrefix.slice(0, -1);
    this.clientsByPrefix.set(barePrefix, brainConn);
    this.debugStateUpdated();
    return idPrefix;
  }

  /**
   * Invoked by a connection when its client reports its capabilities.  This
   * allows us to unblock any requests currently tracked in
   * `awaitingClientsByCapability`.
   */
  reportClientCapabilities(brainConn, capabilities) {
    for (const capability of capabilities) {
      //console.log('processing client capability:', capability);
      if (this.awaitingClientsByCapability.has(capability)) {
        for (const resolve of this.awaitingClientsByCapability.get(capability)) {
          //console.log('  resolving awaiting client...');
          resolve(brainConn);
        }
        this.awaitingClientsByCapability.delete(capability);
      }
    }

    this.debugStateUpdated();
  }

  unregisterClient(brainConn, idPrefix) {
    const barePrefix = idPrefix.slice(0, -1);
    this.clientsByPrefix.delete(barePrefix);

    this.debugStateUpdated();
  }

  _messageContainerId(prefixedContainerId, messageType, extraProps) {
    const clientId = extractClientId(prefixedContainerId);
    const conn = this.clientsByPrefix.get(clientId);

    if (!conn) {
      //console.warn('Got', messageType, 'request for missing client:', clientId);
      return;
    }

    conn.sendMessage(messageType, {
      items: [
        Object.assign(
          { containerId: extractUnprefixedContainerId(prefixedContainerId) },
          extraProps)
      ]
    });
  }

  focusContainerId(prefixedContainerId, prefixedSlotId) {
    const focusSlotId = extractUnprefixedContainerId(prefixedSlotId);
    return this._messageContainerId(
      prefixedContainerId, 'selectThings',
      {
        focusSlotId
      });
  }

  fadeContainerId(prefixedContainerId, value) {
    return this._messageContainerId(
      prefixedContainerId, 'fadeThings',
      {
        value
      });
  }

  /**
   * Synchronously locate a connection with the desired capability, returning
   * null if one could not be found.
   */
  _findConnWithCapability(capability) {
    for (const conn of this.clientsByPrefix.values()) {
      if (conn.capabilities.indexOf(capability) !== -1) {
        return conn;
      }
    }

    return null;
  }

  /**
   * Synchronously tries to find a connection with the desired capability.  If
   * one is not present, asynchronously wait for one to show up.
   */
  async _awaitConnWithCapability(capability) {
    //console.log('looking for connection with capability', capability);
    let conn = this._findConnWithCapability(capability);
    if (conn) {
      //console.log('found one, returning it synchronously');
      return conn;
    }
    //console.log('did not find one, async waiting)');

    let pending = this.awaitingClientsByCapability.get(capability);
    if (!pending) {
      pending = [];
      this.awaitingClientsByCapability.set(capability, pending);
    }
    const promise = new Promise((resolve) => {
      pending.push(resolve);
    });
    conn = await promise;
    return conn;
  }

  async asyncRenderHTML(args) {
    const conn = await this._awaitConnWithCapability('renderHtml-0');
    //console.log('got connection, sending message and awaiting reply');
    const reply = await conn.sendMessageAwaitingReply('renderHtml', args);
    //console.log('received reply');
    return reply;
  }
}

module.exports.BrainBoss = BrainBoss;
