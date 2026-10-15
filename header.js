
(() => {
  const script = document.currentScript;

  if (!script || !script.src) {
    console.error("Shared header: could not locate header.js.");
    return;
  }

  const baseUrl = new URL("./", script.src);
  const headerUrl = new URL("header.html", baseUrl);
  const cssUrl = new URL("header.css", baseUrl);

  if (!document.querySelector("[data-shared-header-css]")) {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = cssUrl.href;
    stylesheet.dataset.sharedHeaderCss = "true";
    document.head.appendChild(stylesheet);
  }

  async function loadHeader() {
    const target = document.getElementById("site-header");

    if (!target) {
      console.error(
        'Shared header: add <div id="site-header"></div> to the page.'
      );
      return;
    }

    try {
      const response = await fetch(headerUrl.href);

      if (!response.ok) {
        throw new Error(`Could not load header.html (${response.status})`);
      }

      target.innerHTML = await response.text();

      target.querySelectorAll("[data-route]").forEach((link) => {
        link.href = new URL(link.dataset.route, baseUrl).href;
      });

      target.querySelectorAll("[data-route-src]").forEach((img) => {
        img.src = new URL(img.dataset.routeSrc, baseUrl).href;
      });

      await initializeSharedHeader();

      document.dispatchEvent(
        new CustomEvent("shared-header-loaded")
      );
    } catch (error) {
      console.error("Shared header failed to load:", error);
      target.textContent = "The site header couldn't load. Please refresh.";
    }
  }

  async function initializeSharedHeader() {
    if (!window.supabase) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src =
          "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    const db = window.supabase.createClient(
      "https://cwmmlsaccrtcxagehhkt.supabase.co",
      "sb_publishable_PeeW6cNPzT2lo9sKgYTsJA_m2t2Wn_P"
    );
    window.sharedSupabase = db; 

    const loginLink = document.getElementById("loginlink");
    const accountLink = document.getElementById("accountlink");
    const usernameDisplay =
      document.getElementById("username-display");
    const moneyDisplay = document.getElementById("money-display");
    const bell = document.getElementById("notifbell");

    let currentUserId = null;
    let audioUnlocked = false;
    let lastAlertedKey = "";
    let refreshInProgress = false;

    const favicon =
      document.querySelector('link[rel~="icon"]') ||
      document.createElement("link");

    favicon.rel = "icon";

    if (!favicon.parentNode) {
      document.head.appendChild(favicon);
    }

    function setFavicon(hasUnread) {
      favicon.href = new URL(
        hasUnread ? "notificon.ico" : "icon.ico",
        baseUrl
      ).href;
    }

    function getCurrentRoomToIgnore() {
      if (document.hidden) return null;

      return new URLSearchParams(location.search).get("room");
    }

    function setNotificationAppearance(hasUnread) {
      if (bell) {
        bell.src = new URL(
          hasUnread ? "notif.png" : "bell.png",
          baseUrl
        ).href;
      }

      setFavicon(hasUnread);
    }

    function playNotificationSound() {
      const audio = new Audio(
        new URL("notifsnd.mp3", baseUrl).href
      );

      audio.play().catch((error) => {
        console.info(
          "Notification sound could not play. The browser may require user interaction.",
          error
        );
      });
    }

    function alertForNewNotification(key) {
      if (key === lastAlertedKey) return;

      lastAlertedKey = key;
      setNotificationAppearance(true);

      if (audioUnlocked) {
        playNotificationSound();
      }
    }

    function unlockAudio() {
      audioUnlocked = true;
    }

    document.addEventListener("pointerdown", unlockAudio, {
      once: true
    });

    document.addEventListener("keydown", unlockAudio, {
      once: true
    });

    async function updateAccount(session) {
      if (!loginLink || !accountLink) return;

      if (!session) {
        currentUserId = null;
        loginLink.style.display = "block";
        accountLink.style.display = "none";

        if (usernameDisplay) usernameDisplay.textContent = "";
        if (moneyDisplay) moneyDisplay.textContent = "0";

        setNotificationAppearance(false);
        return;
      }

      currentUserId = session.user.id;
      loginLink.style.display = "none";
      accountLink.style.display = "block";

      const { data, error } = await db
        .from("profiles")
        .select("username, money")
        .eq("id", currentUserId)
        .maybeSingle();

      if (error) {
        console.error("Could not load header profile:", error);
        if (usernameDisplay) usernameDisplay.textContent = "Account";
        if (moneyDisplay) moneyDisplay.textContent = "—";
        return;
      }

      if (usernameDisplay) {
        usernameDisplay.textContent = data?.username || "User";
      }

      if (moneyDisplay) {
        moneyDisplay.textContent = data?.money ?? 0;
      }
    }

    async function getUnreadState() {
      if (!currentUserId) {
        return { hasUnread: false, keys: [] };
      }

      const myId = currentUserId;
      const ignoredRoom = getCurrentRoomToIgnore();
      const keys = [];

      const { data: requests, error: requestError } = await db
        .from("relationships")
        .select("id")
        .eq("id_2", myId)
        .eq("status", "requested");

      if (requestError) {
        throw requestError;
      }

      for (const request of requests || []) {
        keys.push(`friend-request:${request.id}`);
      }

      const { data: renameRequests, error: renameError } = await db
        .from("relationships")
        .select("id, namerequesterid")
        .eq("display_request", true)
        .or(`id_1.eq.${myId},id_2.eq.${myId}`);

      if (renameError) {
        throw renameError;
      }

      for (const request of renameRequests || []) {
        if (request.namerequesterid !== myId) {
          keys.push(`name-request:${request.id}`);
        }
      }

      const { data: memberships, error: membershipError } = await db
        .from("chatroom_allowed_users")
        .select(`
          chatroom_id,
          last_read_sequence,
          chatrooms!inner (
            privacy_type
          )
        `)
        .eq("user_id", myId)
        .eq("chatrooms.privacy_type", "private");

      if (membershipError) {
        throw membershipError;
      }

      const dmMemberships = (memberships || []).filter(
        (membership) => membership.chatroom_id.startsWith("dm_")
      );

      for (const membership of dmMemberships) {
        if (membership.chatroom_id === ignoredRoom) continue;

        const { data: unread, error: unreadError } = await db
          .from("messages")
          .select("id")
          .eq("chatroom_id", membership.chatroom_id)
          .gt(
            "sequence_number",
            membership.last_read_sequence || 0
          )
          .neq("sender_id", myId)
          .limit(1);

        if (unreadError) {
          throw unreadError;
        }

        if (unread?.length) {
          keys.push(`dm:${membership.chatroom_id}`);
        }
      }

      const { data: roomNotifications, error: roomError } = await db
        .from("chatroom_notifications")
        .select("chatroom_id")
        .eq("user_id", myId)
        .eq("enabled", true)
        .eq("up_to_date", false);

      if (roomError) {
        throw roomError;
      }

      for (const notification of roomNotifications || []) {
        if (notification.chatroom_id === ignoredRoom) continue;

        keys.push(`room:${notification.chatroom_id}`);
      }

      return {
        hasUnread: keys.length > 0,
        keys
      };
    }

    async function refreshNotifications() {
      if (!currentUserId || refreshInProgress) return;

      refreshInProgress = true;

      try {
        const state = await getUnreadState();

        setNotificationAppearance(state.hasUnread);


        lastAlertedKey = state.keys.sort().join("|");
      } catch (error) {
        console.error("Could not check notifications:", error);
      } finally {
        refreshInProgress = false;
      }
    }

    async function handleNewMessage(message) {
      if (!currentUserId || !message) return;
      if (message.sender_id === currentUserId) return;

      if (message.chatroom_id === getCurrentRoomToIgnore()) {
        return;
      }

      const isDM = message.chatroom_id.startsWith("dm_");

      if (isDM) {
        const { data: membership, error } = await db
          .from("chatroom_allowed_users")
          .select("user_id")
          .eq("chatroom_id", message.chatroom_id)
          .eq("user_id", currentUserId)
          .maybeSingle();

        if (error || !membership) return;
      } else {
        const { data: preference, error } = await db
          .from("chatroom_notifications")
          .select("enabled")
          .eq("chatroom_id", message.chatroom_id)
          .eq("user_id", currentUserId)
          .eq("enabled", true)
          .maybeSingle();

        if (error || !preference) return;
      }

      alertForNewNotification(
        `message:${message.id || message.chatroom_id + ":" + message.sequence_number}`
      );

      await refreshNotifications();
    }

    let realtimeChannel = null;

    function startRealtimeListeners() {
      if (!currentUserId) return;

      if (realtimeChannel) {
        db.removeChannel(realtimeChannel);
      }

      const myId = currentUserId;

      realtimeChannel = db
        .channel(`shared-header-notifications-${myId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "relationships"
          },
          async (payload) => {
            const record = payload.new;

            if (!record) return;

            const isFriendRequest =
              record.id_2 === myId &&
              record.status === "requested";

            const isNameRequest =
              record.display_request === true &&
              (record.id_1 === myId || record.id_2 === myId) &&
              record.namerequesterid !== myId;

            if (isFriendRequest || isNameRequest) {
              const type = isFriendRequest
                ? "friend-request"
                : "name-request";

              alertForNewNotification(
                `${type}:${record.id}:${record.created_at || ""}`
              );

              await refreshNotifications();
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages"
          },
          async (payload) => {
            await handleNewMessage(payload.new);
          }
        )
        .subscribe();
    }

    const { data: { session }, error: sessionError } =
      await db.auth.getSession();

    if (sessionError) {
      console.error("Could not get session:", sessionError);
    }

    await updateAccount(session);

    if (currentUserId) {
      await refreshNotifications();
      startRealtimeListeners();
    }

    db.auth.onAuthStateChange(async (_event, newSession) => {
      await updateAccount(newSession);

      if (currentUserId) {
        await refreshNotifications();
        startRealtimeListeners();
      } else {
        if (realtimeChannel) {
          await db.removeChannel(realtimeChannel);
          realtimeChannel = null;
        }

        lastAlertedKey = "";
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        refreshNotifications();
      }
    });

    window.addEventListener("focus", refreshNotifications);

    document.addEventListener(
      "refresh-shared-header-notifications",
      refreshNotifications
    );

    document.dispatchEvent(
      new CustomEvent("shared-header-account-ready")
    );
  }

  loadHeader();
})();
