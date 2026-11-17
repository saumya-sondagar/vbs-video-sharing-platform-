const loginScreen = document.getElementById("login-screen");
const loginForm = document.getElementById("login-form");
const loginUsernameInput = document.getElementById("login-username");
const loginStatus = document.getElementById("login-status");
const app = document.getElementById("app");
const currentUserLabel = document.getElementById("current-user-label");
const switchUserButton = document.getElementById("switch-user-btn");
const createButton = document.getElementById("create-btn");
const videoUpload = document.getElementById("video-upload");
const uploadStatus = document.getElementById("upload-status");
const channelNameInput = document.getElementById("channel-name");
const uploadCategory = document.getElementById("upload-category");
const searchInput = document.getElementById("searchbar");
const searchButton = document.getElementById("send-btn");
const savedVideoList = document.getElementById("saved-video-list");
const notificationToast = document.getElementById("notification-toast");
const notificationList = document.getElementById("notification-list");
const categoryButtons = document.querySelectorAll(".bottom-nav [data-category]");

const databaseName = "vsp-video-library";
const databaseVersion = 2;
const videoStoreName = "videos";
const subscriptionStoreName = "subscriptions";
const notificationStoreName = "notifications";
const loginStorageKey = "vsp-demo-username";
const videoUrls = [];

let database;
let databasePromise;
let currentUser = "";
let currentCategory = "all";
let savedVideos = [];
let subscriptionOwnerKeys = new Set();

function normalizeUsername(username) {
    return username.trim().toLowerCase();
}

function createId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function getErrorMessage(error) {
    return error && error.message
        ? error.message
        : "An unexpected storage error occurred.";
}

function openVideoDatabase() {
    return new Promise(function (resolve, reject) {
        const request = window.indexedDB.open(databaseName, databaseVersion);

        request.onupgradeneeded = function () {
            const db = request.result;
            if (!db.objectStoreNames.contains(videoStoreName)) {
                db.createObjectStore(videoStoreName, { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains(subscriptionStoreName)) {
                db.createObjectStore(subscriptionStoreName, { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains(notificationStoreName)) {
                db.createObjectStore(notificationStoreName, { keyPath: "id" });
            }
        };
        request.onsuccess = function () {
            const openedDatabase = request.result;
            openedDatabase.onversionchange = function () {
                openedDatabase.close();
                if (database === openedDatabase) {
                    database = null;
                    databasePromise = null;
                }
            };
            database = openedDatabase;
            resolve(openedDatabase);
        };
        request.onerror = function () {
            reject(request.error || new Error("Could not open local video storage."));
        };
        request.onblocked = function () {
            loginStatus.textContent = "Close other copies of this page to open local storage.";
        };
    });
}

async function ensureDatabase() {
    if (!window.indexedDB) {
        throw new Error("This browser does not support local storage.");
    }

    if (!database) {
        if (!databasePromise) {
            databasePromise = openVideoDatabase();
        }
        try {
            await databasePromise;
        } catch (error) {
            databasePromise = null;
            throw error;
        }
    }
}

function runTransaction(storeNames, mode, action) {
    return new Promise(function (resolve, reject) {
        let transaction;
        try {
            transaction = database.transaction(storeNames, mode);
            action(transaction);
        } catch (error) {
            reject(error);
            return;
        }

        transaction.oncomplete = function () {
            resolve();
        };
        transaction.onerror = function () {
            reject(transaction.error || new Error("The storage operation failed."));
        };
        transaction.onabort = function () {
            reject(transaction.error || new Error("The storage operation was canceled."));
        };
    });
}

function getAllRecords(storeName) {
    return new Promise(function (resolve, reject) {
        const transaction = database.transaction(storeName, "readonly");
        const request = transaction.objectStore(storeName).getAll();
        let records = [];

        request.onsuccess = function () {
            records = request.result;
        };
        request.onerror = function () {
            reject(request.error || new Error("Could not read local data."));
        };
        transaction.oncomplete = function () {
            resolve(records);
        };
        transaction.onerror = function () {
            reject(transaction.error || new Error("Could not read local data."));
        };
        transaction.onabort = function () {
            reject(transaction.error || new Error("Reading local data was canceled."));
        };
    });
}

function saveVideo(video) {
    return runTransaction([videoStoreName], "readwrite", function (transaction) {
        transaction.objectStore(videoStoreName).put(video);
    });
}

function makeNotification(recipient, message) {
    return {
        id: createId(),
        recipientKey: normalizeUsername(recipient),
        recipient: recipient,
        message: message,
        createdAt: Date.now()
    };
}

function saveVideoAndNotification(video, notification) {
    return runTransaction(
        [videoStoreName, notificationStoreName],
        "readwrite",
        function (transaction) {
            transaction.objectStore(videoStoreName).put(video);
            if (notification) {
                transaction.objectStore(notificationStoreName).put(notification);
            }
        }
    );
}

function clearVideoUrls() {
    videoUrls.forEach(function (url) {
        URL.revokeObjectURL(url);
    });
    videoUrls.length = 0;
}

function addTextElement(parent, tagName, text, className) {
    const element = document.createElement(tagName);
    element.textContent = text;
    if (className) {
        element.className = className;
    }
    parent.appendChild(element);
    return element;
}

function getVideoLikes(video) {
    return Array.isArray(video.likes) ? video.likes : [];
}

function getVideoComments(video) {
    return Array.isArray(video.comments) ? video.comments : [];
}

function makeCommentForm(video) {
    const form = document.createElement("form");
    form.className = "comment-form";

    const ratingLabel = document.createElement("label");
    ratingLabel.textContent = "Rating";
    const ratingSelect = document.createElement("select");
    ratingSelect.setAttribute("aria-label", "Rating from 1 to 5");
    for (let rating = 1; rating <= 5; rating += 1) {
        const option = document.createElement("option");
        option.value = String(rating);
        option.textContent = rating + " / 5";
        ratingSelect.appendChild(option);
    }
    ratingSelect.value = "5";
    ratingLabel.appendChild(ratingSelect);

    const commentInput = document.createElement("textarea");
    commentInput.maxLength = 500;
    commentInput.required = true;
    commentInput.placeholder = "Write a comment";
    commentInput.setAttribute("aria-label", "Write a comment");

    const submitButton = document.createElement("button");
    submitButton.type = "submit";
    submitButton.textContent = "Rate and comment";

    form.appendChild(ratingLabel);
    form.appendChild(commentInput);
    form.appendChild(submitButton);
    form.addEventListener("submit", function (event) {
        submitComment(event, video, ratingSelect, commentInput, submitButton);
    });
    return form;
}

function renderComments(video, parent) {
    const comments = getVideoComments(video);
    const ratings = comments.map(function (comment) {
        return Number(comment.rating) || 0;
    }).filter(function (rating) {
        return rating > 0;
    });
    const average = ratings.length
        ? (ratings.reduce(function (total, rating) {
            return total + rating;
        }, 0) / ratings.length).toFixed(1)
        : "No ratings yet";

    addTextElement(
        parent,
        "p",
        ratings.length
            ? "Rating: " + average + " / 5 (" + ratings.length + ")"
            : average
    );

    const commentList = document.createElement("ul");
    commentList.className = "comment-list";
    if (comments.length === 0) {
        addTextElement(commentList, "li", "No comments yet.");
    } else {
        comments.forEach(function (comment) {
            addTextElement(
                commentList,
                "li",
                "@" + comment.author + " rated " + comment.rating + "/5: " + comment.text
            );
        });
    }
    parent.appendChild(commentList);
    parent.appendChild(makeCommentForm(video));
}

function renderSavedVideos(query) {
    clearVideoUrls();
    savedVideoList.replaceChildren();

    const normalizedQuery = query.trim().toLowerCase();
    const matchingVideos = savedVideos.filter(function (video) {
        const categoryMatches = currentCategory === "all"
            || (video.category || "all") === currentCategory;
        return categoryMatches && video.name.toLowerCase().includes(normalizedQuery);
    });

    if (matchingVideos.length === 0) {
        const emptyMessage = savedVideos.length === 0
            ? "No videos saved yet."
            : currentCategory === "music" && normalizedQuery === ""
                ? "No Music videos saved yet."
                : "No saved videos match this filter.";
        addTextElement(savedVideoList, "p", emptyMessage);
        return matchingVideos.length;
    }

    matchingVideos.forEach(function (savedVideo) {
        const item = document.createElement("article");
        item.className = "saved-video";

        const header = document.createElement("div");
        header.className = "saved-video-header";
        addTextElement(header, "h2", savedVideo.name);
        addTextElement(
            header,
            "p",
            "Channel: @" + (savedVideo.channelName || savedVideo.owner)
        );
        item.appendChild(header);

        const player = document.createElement("video");
        player.controls = true;
        player.preload = "metadata";
        player.setAttribute("aria-label", "Play " + savedVideo.name);
        const videoUrl = URL.createObjectURL(savedVideo.file);
        videoUrls.push(videoUrl);
        player.src = videoUrl;
        item.appendChild(player);

        const socialActions = document.createElement("div");
        socialActions.className = "social-actions";
        const ownerKey = normalizeUsername(savedVideo.owner);
        const isOwnVideo = ownerKey === normalizeUsername(currentUser);
        const likes = getVideoLikes(savedVideo);

        const likeButton = document.createElement("button");
        likeButton.type = "button";
        const hasLiked = likes.includes(normalizeUsername(currentUser));
        likeButton.textContent = isOwnVideo
            ? "Your video (" + likes.length + " likes)"
            : (hasLiked ? "Unlike (" : "Like (") + likes.length + ")";
        likeButton.disabled = isOwnVideo;
        likeButton.addEventListener("click", function () {
            toggleLike(savedVideo, likeButton);
        });
        socialActions.appendChild(likeButton);

        const subscribeButton = document.createElement("button");
        subscribeButton.type = "button";
        subscribeButton.textContent = isOwnVideo
            ? "Your channel"
            : (subscriptionOwnerKeys.has(ownerKey) ? "Subscribed" : "Subscribe");
        subscribeButton.disabled = isOwnVideo;
        subscribeButton.addEventListener("click", function () {
            toggleSubscription(savedVideo, subscribeButton);
        });
        socialActions.appendChild(subscribeButton);
        item.appendChild(socialActions);

        const commentsSection = document.createElement("section");
        commentsSection.className = "comments";
        renderComments(savedVideo, commentsSection);
        item.appendChild(commentsSection);
        savedVideoList.appendChild(item);
    });

    return matchingVideos.length;
}

async function refreshSavedVideos() {
    savedVideos = await getAllRecords(videoStoreName);
    for (const video of savedVideos) {
        let changed = false;
        if (!video.owner) {
            video.owner = currentUser;
            video.channelName = video.channelName || currentUser;
            changed = true;
        }
        if (!Array.isArray(video.likes)) {
            video.likes = [];
            changed = true;
        }
        if (!Array.isArray(video.comments)) {
            video.comments = [];
            changed = true;
        }
        if (changed) {
            await saveVideo(video);
        }
    }

    savedVideos.sort(function (first, second) {
        return second.savedAt - first.savedAt;
    });
    return renderSavedVideos(searchInput.value);
}

async function toggleLike(video, button) {
    button.disabled = true;
    const userKey = normalizeUsername(currentUser);
    const likes = getVideoLikes(video);
    const hasLiked = likes.includes(userKey);
    const updatedVideo = Object.assign({}, video, {
        likes: hasLiked
            ? likes.filter(function (username) {
                return username !== userKey;
            })
            : likes.concat(userKey)
    });
    const owner = video.owner || video.channelName;
    const notification = !hasLiked && normalizeUsername(owner) !== userKey
        ? makeNotification(owner, "@" + currentUser + " liked your video \"" + video.name + "\".")
        : null;

    try {
        await saveVideoAndNotification(updatedVideo, notification);
        await refreshSavedVideos();
        if (notification) {
            showNotificationToast(
                "Notification saved for @" + notification.recipient + ": " + notification.message
            );
        } else {
            uploadStatus.textContent = hasLiked ? "Like removed." : "Video liked.";
        }
    } catch (error) {
        button.disabled = false;
        uploadStatus.textContent = "Could not update like: " + getErrorMessage(error);
    }
}

async function toggleSubscription(video, button) {
    button.disabled = true;
    const owner = video.owner || video.channelName;
    const ownerKey = normalizeUsername(owner);
    const subscriberKey = normalizeUsername(currentUser);
    const subscriptionId = subscriberKey + "|" + ownerKey;
    const isSubscribed = subscriptionOwnerKeys.has(ownerKey);
    const notification = !isSubscribed
        ? makeNotification(owner, "@" + currentUser + " subscribed to your channel.")
        : null;

    try {
        await runTransaction(
            [subscriptionStoreName, notificationStoreName],
            "readwrite",
            function (transaction) {
                const subscriptions = transaction.objectStore(subscriptionStoreName);
                if (isSubscribed) {
                    subscriptions.delete(subscriptionId);
                } else {
                    subscriptions.put({
                        id: subscriptionId,
                        subscriberKey: subscriberKey,
                        subscriber: currentUser,
                        ownerKey: ownerKey,
                        channelName: video.channelName || owner,
                        createdAt: Date.now()
                    });
                    transaction.objectStore(notificationStoreName).put(notification);
                }
            }
        );
        await refreshSubscriptions();
        renderSavedVideos(searchInput.value);
        if (notification) {
            showNotificationToast(
                "Notification saved for @" + notification.recipient + ": " + notification.message
            );
        } else {
            uploadStatus.textContent = "You unsubscribed from @" + (video.channelName || owner) + ".";
        }
    } catch (error) {
        button.disabled = false;
        uploadStatus.textContent = "Could not update subscription: " + getErrorMessage(error);
    }
}

async function submitComment(event, video, ratingSelect, commentInput, submitButton) {
    event.preventDefault();
    const text = commentInput.value.trim();
    if (!text) {
        uploadStatus.textContent = "Write a comment before submitting your rating.";
        return;
    }

    submitButton.disabled = true;
    const updatedVideo = Object.assign({}, video, {
        comments: getVideoComments(video).concat({
            id: createId(),
            author: currentUser,
            rating: Number(ratingSelect.value),
            text: text,
            createdAt: Date.now()
        })
    });

    try {
        await saveVideo(updatedVideo);
        await refreshSavedVideos();
        uploadStatus.textContent = "Your rating and comment were saved.";
    } catch (error) {
        submitButton.disabled = false;
        uploadStatus.textContent = "Could not save your comment: " + getErrorMessage(error);
    }
}

async function refreshNotifications(showLatest) {
    const notifications = await getAllRecords(notificationStoreName);
    const userNotifications = notifications
        .filter(function (notification) {
            return notification.recipientKey === normalizeUsername(currentUser);
        })
        .sort(function (first, second) {
            return second.createdAt - first.createdAt;
        });

    notificationList.replaceChildren();
    if (userNotifications.length === 0) {
        addTextElement(notificationList, "li", "No notifications yet.");
        return;
    }

    userNotifications.forEach(function (notification) {
        addTextElement(
            notificationList,
            "li",
            notification.message + " " + new Date(notification.createdAt).toLocaleString()
        );
    });

    if (showLatest) {
        showNotificationToast("Notification: " + userNotifications[0].message);
    }
}

function showNotificationToast(message) {
    notificationToast.textContent = message;
    notificationToast.hidden = false;
}

async function refreshSubscriptions() {
    const subscriptions = await getAllRecords(subscriptionStoreName);
    const userKey = normalizeUsername(currentUser);
    subscriptionOwnerKeys = new Set(
        subscriptions
            .filter(function (subscription) {
                return subscription.subscriberKey === userKey;
            })
            .map(function (subscription) {
                return subscription.ownerKey;
            })
    );
}

function searchSavedVideos() {
    const resultCount = renderSavedVideos(searchInput.value);
    const categoryName = currentCategory === "music" ? "Music videos" : "videos";
    uploadStatus.textContent = searchInput.value.trim()
        ? "Found " + resultCount + " matching " + categoryName + "."
        : currentCategory === "music"
            ? "Showing saved Music videos."
            : "Showing all saved videos.";
}

async function signIn(username, rememberUsername) {
    loginStatus.textContent = "Opening local video library...";
    try {
        await ensureDatabase();
    } catch (error) {
        loginStatus.textContent = "Could not open the local library: " + getErrorMessage(error);
        return false;
    }

    currentUser = username;
    currentUserLabel.textContent = "Signed in as @" + currentUser;
    channelNameInput.value = currentUser;
    loginScreen.hidden = true;
    app.hidden = false;

    if (rememberUsername) {
        try {
            window.localStorage.setItem(loginStorageKey, username);
        } catch (error) {
            uploadStatus.textContent = "Signed in, but this browser could not remember your username: " +
                getErrorMessage(error);
        }
    }

    try {
        await refreshSavedVideos();
        await refreshSubscriptions();
        renderSavedVideos(searchInput.value);
        await refreshNotifications(true);
    } catch (error) {
        uploadStatus.textContent = "Could not load all local data: " + getErrorMessage(error);
    }

    return true;
}

loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    const username = loginUsernameInput.value.trim();
    if (!username) {
        loginStatus.textContent = "Enter a username to continue.";
        return;
    }

    await signIn(username, true);
});

switchUserButton.addEventListener("click", function () {
    try {
        window.localStorage.removeItem(loginStorageKey);
    } catch (error) {
        uploadStatus.textContent = "Could not clear the remembered username: " + getErrorMessage(error);
    }
    currentUser = "";
    savedVideos = [];
    subscriptionOwnerKeys = new Set();
    searchInput.value = "";
    currentCategory = "all";
    categoryButtons.forEach(function (button) {
        button.setAttribute(
            "aria-pressed",
            String(button.dataset.category === "all" && button.textContent === "Home")
        );
    });
    clearVideoUrls();
    savedVideoList.replaceChildren();
    notificationList.replaceChildren();
    notificationToast.hidden = true;
    app.hidden = true;
    loginScreen.hidden = false;
    loginUsernameInput.value = "";
    loginStatus.textContent = "Enter another username to switch local demo users.";
    loginUsernameInput.focus();
});

function resumeRememberedUser() {
    let rememberedUsername;
    try {
        rememberedUsername = window.localStorage.getItem(loginStorageKey);
    } catch (error) {
        loginStatus.textContent = "Could not read the remembered username: " + getErrorMessage(error);
        return;
    }

    if (rememberedUsername) {
        loginUsernameInput.value = rememberedUsername;
        signIn(rememberedUsername, false);
    }
}

createButton.addEventListener("click", function () {
    videoUpload.click();
});

searchButton.addEventListener("click", searchSavedVideos);
searchInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
        event.preventDefault();
        searchSavedVideos();
    }
});

categoryButtons.forEach(function (button) {
    button.addEventListener("click", function () {
        currentCategory = button.dataset.category;
        categoryButtons.forEach(function (categoryButton) {
            categoryButton.setAttribute(
                "aria-pressed",
                String(categoryButton === button)
            );
        });
        searchSavedVideos();
    });
});

videoUpload.addEventListener("change", async function () {
    const selectedFiles = Array.from(videoUpload.files);
    videoUpload.value = "";
    if (selectedFiles.length === 0) {
        return;
    }

    const mp4Files = selectedFiles.filter(function (file) {
        return file.name.toLowerCase().endsWith(".mp4");
    });
    const skippedCount = selectedFiles.length - mp4Files.length;
    if (mp4Files.length === 0) {
        uploadStatus.textContent = "Please select one or more MP4 videos.";
        return;
    }

    const channelName = channelNameInput.value.trim() || currentUser;
    let savedCount = 0;
    let saveError = null;

    for (const file of mp4Files) {
        const video = {
            id: createId(),
            name: file.name,
            file: file,
            category: uploadCategory.value,
            owner: currentUser,
            channelName: channelName,
            likes: [],
            comments: [],
            savedAt: Date.now()
        };
        try {
            await saveVideo(video);
            savedCount += 1;
        } catch (error) {
            saveError = error;
            break;
        }
    }

    try {
        await refreshSavedVideos();
    } catch (error) {
        saveError = saveError || error;
    }

    const messages = [];
    if (savedCount > 0) {
        messages.push(savedCount + (savedCount === 1 ? " video saved locally." : " videos saved locally."));
    }
    if (skippedCount > 0) {
        messages.push(skippedCount + " non-MP4 file(s) skipped.");
    }
    if (saveError) {
        messages.push("Storage error: " + getErrorMessage(saveError));
    }
    if (messages.length === 0) {
        messages.push("Select one or more MP4 videos.");
    }
    uploadStatus.textContent = messages.join(" ");
});

resumeRememberedUser();
