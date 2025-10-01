import React, { useState, useEffect, useRef, useCallback } from 'react';
import { UserProfile, Message, Contact, CallData, FriendRequest, CallLog, BlockedUser } from './types';
import { 
    AddFriendIcon, MenuIcon, BackIcon, VoiceCallIcon, VideoCallIcon, SendIcon, EndCallIcon, AcceptCallIcon, MuteIcon, UnmuteIcon, CameraOnIcon, CameraOffIcon, ScreenShareIcon, BlockIcon, CopyIcon, SettingsIcon, SentIcon, DeliveredIcon, ReadIcon, SearchIcon
} from './components/Icons';
import { useI18n } from './i18n';

// NOTE: Firebase SDK is loaded from CDN in index.html.
// We declare 'firebase' as a global variable for TypeScript.
declare const firebase: any;

// --- FIREBASE CONFIG ---
// Replace with your actual Firebase configuration. 
// These placeholders are formatted correctly to prevent initialization errors.
const firebaseConfig = {
  apiKey: "AIzaSyCQXuo4YuJYquMLr4-T1d2oyADbncg27eA",
  authDomain: "shvan-tech-app.firebaseapp.com",
  databaseURL: "https://shvan-tech-app-default-rtdb.firebaseio.com",
  projectId: "shvan-tech-app",
  storageBucket: "shvan-tech-app.firebasestorage.app",
  messagingSenderId: "549568845634",
  appId: "1:549568845634:web:8a1e5e15a083335622dadb",
  measurementId: "G-W0GNNPFE6T"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.database();
const messaging = firebase.messaging.isSupported() ? firebase.messaging() : null;

// FIX: Moved generateRandomId to module scope to be accessible by ProfileSetupModal
const generateRandomId = () => Math.random().toString(36).substring(2, 8).toUpperCase();

// --- Main App Component ---
const App: React.FC = () => {
    const { t } = useI18n();
    const [view, setView] = useState<'auth' | 'main' | 'chat'>('auth');
    const [modal, setModal] = useState<'none' | 'profile-setup' | 'add-friend' | 'profile-view' | 'incoming-call' | 'device-settings'>('none');
    
    const [currentUser, setCurrentUser] = useState<any | null>(null);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [notificationPermission, setNotificationPermission] = useState(Notification.permission);

    // Main View State
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
    const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
    const [callLogs, setCallLogs] = useState<CallLog[]>([]);
    const [unreadCounts, setUnreadCounts] = useState<{[key: string]: number}>({});

    // Chat View State
    const [currentChatPartner, setCurrentChatPartner] = useState<UserProfile | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);

    // Call State
    const [callView, setCallView] = useState<'none' | 'video-call' | 'voice-call'>('none');
    const [incomingCall, setIncomingCall] = useState<CallData | null>(null);
    const [currentCall, setCurrentCall] = useState<CallData | null>(null);
    const [isMuted, setIsMuted] = useState(false);
    const [isCameraOff, setIsCameraOff] = useState(false);
    const [callStartTime, setCallStartTime] = useState<number | null>(null);
    const [callDuration, setCallDuration] = useState('00:00');
    const [devices, setDevices] = useState<{ audioInput: MediaDeviceInfo[], videoInput: MediaDeviceInfo[], audioOutput: MediaDeviceInfo[] }>({ audioInput: [], videoInput: [], audioOutput: [] });
    const [selectedDeviceIds, setSelectedDeviceIds] = useState({ audioInputId: '', videoInputId: '', audioOutputId: '' });
    const [isEndCallModalVisible, setIsEndCallModalVisible] = useState(false);
    const localStreamRef = useRef<MediaStream | null>(null);
    const remoteStreamRef = useRef<MediaStream | null>(null);
    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    const originalVideoTrackRef = useRef<MediaStreamTrack | null>(null);
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const remoteAudioRef = useRef<HTMLAudioElement>(null);
    const ringtoneRef = useRef<HTMLAudioElement>(null);
    
    // Ref to hold the cleanup function for the user profile listener
    const userListenerCleanupRef = useRef<(() => void) | null>(null);

    // --- Push Notification Setup ---
    useEffect(() => {
        if (!messaging) return;

        const registerServiceWorker = () => {
            // Pass Firebase config to the service worker to avoid hardcoding keys.
            const swUrl = `./firebase-messaging-sw.js?apiKey=${import.meta.env.VITE_FIREBASE_API_KEY}&authDomain=${import.meta.env.VITE_FIREBASE_AUTH_DOMAIN}&databaseURL=${import.meta.env.VITE_FIREBASE_DATABASE_URL}&projectId=${import.meta.env.VITE_FIREBASE_PROJECT_ID}&storageBucket=${import.meta.env.VITE_FIREBASE_STORAGE_BUCKET}&messagingSenderId=${import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID}&appId=${import.meta.env.VITE_FIREBASE_APP_ID}&measurementId=${import.meta.env.VITE_FIREBASE_MEASUREMENT_ID}`;

            navigator.serviceWorker.register(swUrl)
                .then((registration) => {
                    messaging.useServiceWorker(registration);
                    
                    // Handle foreground messages
                    messaging.onMessage((payload: any) => {
                        console.log('Message received in foreground.', payload);
                        alert(`[${t('appTitle')}] ${payload.notification.title}: ${payload.notification.body}`);
                    });
                }).catch((err) => {
                    console.error('Service Worker registration failed:', err);
                });
        };

        // Always waiting for the 'load' event is the most robust way to ensure
        // the document is ready for service worker registration.
        window.addEventListener('load', registerServiceWorker);

        // Cleanup the event listener on component unmount
        return () => window.removeEventListener('load', registerServiceWorker);
    }, [t]);

    const requestNotificationPermission = async () => {
        if (!messaging || !userProfile) return;
        try {
            await messaging.requestPermission();
            // Replace with your VAPID key from Firebase project settings -> Cloud Messaging
            const token = await messaging.getToken({ vapidKey: 'YOUR_PUBLIC_VAPID_KEY_FROM_FIREBASE_CONSOLE' });
            if (token) {
                await db.ref(`users/${userProfile.uid}/fcmToken`).set(token);
                setNotificationPermission('granted');
            } else {
                console.warn('No registration token available. Request permission to generate one.');
            }
        } catch (error) {
            console.error('Unable to get permission to notify.', error);
            if (Notification.permission === 'denied') {
                setNotificationPermission('denied');
            }
        }
    };

    // --- Utility Functions ---
    const showView = (viewName: 'auth' | 'main' | 'chat') => {
        setView(viewName);
    };

    const showModal = (modalName: 'none' | 'profile-setup' | 'add-friend' | 'profile-view' | 'incoming-call' | 'device-settings') => {
        setModal(modalName);
    };

    // --- Authentication ---
    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged((user: any) => {
            // Clean up any previous user's listener before setting up a new one
            if (userListenerCleanupRef.current) {
                userListenerCleanupRef.current();
                userListenerCleanupRef.current = null;
            }

            if (user) {
                setCurrentUser(user);
                const userRef = db.ref(`users/${user.uid}`);
                
                const listener = (snapshot: any) => {
                    if (snapshot.exists()) {
                        // Always ensure the profile object in state has the correct UID from the auth user.
                        const profileData: UserProfile = { ...snapshot.val(), uid: user.uid };
                        
                        // If customId is missing, generate and save it.
                        // The listener will re-fire with the updated data.
                        if (!profileData.customId) {
                            const newId = generateRandomId();
                             // Also write the UID to the database to ensure data consistency.
                            userRef.update({ customId: newId, uid: user.uid });
                        } else {
                            // Once the profile is complete, set it and show the main view.
                            setUserProfile(profileData);
                            if (Notification.permission === 'granted' && !profileData.fcmToken) {
                                requestNotificationPermission();
                            }
                            showView('main');
                        }
                    } else {
                        // New user, needs to set up a profile.
                        showModal('profile-setup');
                    }
                };
                
                userRef.on('value', listener);

                // Store the cleanup function for this user's listener in the ref
                userListenerCleanupRef.current = () => userRef.off('value', listener);

            } else {
                setCurrentUser(null);
                setUserProfile(null);
                showView('auth');
                // Cleanup all listeners and state
                setContacts([]);
                setFriendRequests([]);
                setCallLogs([]);
                setUnreadCounts({});
            }
        });

        // Main cleanup on component unmount
        return () => {
            if (userListenerCleanupRef.current) {
                userListenerCleanupRef.current();
            }
            unsubscribe();
        };
    }, []);

    const handleLogout = () => {
        if(userProfile?.fcmToken) {
            db.ref(`users/${userProfile.uid}/fcmToken`).remove();
        }
        auth.signOut();
    };
    
    // --- User Actions (Block/Unblock) ---
    const handleBlockUser = useCallback((uidToBlock: string) => {
        if (!userProfile) return;
        const updates: {[key: string]: any} = {};
        updates[`/users/${userProfile.uid}/blocked/${uidToBlock}`] = true;
        // Remove from contacts
        updates[`/users/${userProfile.uid}/contacts/${uidToBlock}`] = null;
        updates[`/users/${uidToBlock}/contacts/${userProfile.uid}`] = null;
        
        db.ref().update(updates);

        // If currently chatting with the blocked user, go back to main view
        if (currentChatPartner?.uid === uidToBlock) {
            showView('main');
            setCurrentChatPartner(null);
        }
    }, [userProfile, currentChatPartner]);

    const handleUnblockUser = useCallback((uidToUnblock: string) => {
        if (!userProfile) return;
        db.ref(`users/${userProfile.uid}/blocked/${uidToUnblock}`).remove();
    }, [userProfile]);

    // --- Data Listeners ---
    useEffect(() => {
        if (!userProfile) return;

        // Listen for contacts
        const contactsRef = db.ref(`users/${userProfile.uid}/contacts`);
        contactsRef.on('value', (snapshot: any) => {
            if (!snapshot.exists()) {
                setContacts([]);
                return;
            };
            const contactUids = Object.keys(snapshot.val());
            const unblockedContactUids = contactUids.filter(uid => !userProfile.blocked || !userProfile.blocked[uid]);

            const contactPromises = unblockedContactUids.map(uid => 
                db.ref(`users/${uid}`).once('value')
            );
            Promise.all(contactPromises).then(contactSnapshots => {
                const fetchedContacts = contactSnapshots.map(snap => snap.val() as UserProfile).filter(Boolean);
                setContacts(fetchedContacts);
            });
        });

        // Listen for friend requests
        const requestsRef = db.ref(`requests/${userProfile.uid}`);
        requestsRef.on('value', (snapshot: any) => {
            if (snapshot.exists()) {
                const allRequests = Object.values(snapshot.val()) as FriendRequest[];
                const filteredRequests = allRequests.filter(req => !userProfile.blocked || !userProfile.blocked[req.fromId]);
                setFriendRequests(filteredRequests);
            } else {
                setFriendRequests([]);
            }
        });
        
        // Listen for unread messages and update status to 'delivered'
        const unreadRef = db.ref(`unreadCounts/${userProfile.uid}`);
        unreadRef.on('value', (snapshot: any) => {
            const newUnreadCounts = snapshot.val() || {};
            setUnreadCounts(newUnreadCounts);
            
            // Logic to update message status to 'delivered'
            Object.keys(newUnreadCounts).forEach(senderId => {
                if (newUnreadCounts[senderId] > 0) {
                    const chatMembers = [userProfile.uid, senderId].sort();
                    const chatId = chatMembers.join('_');
                    const messagesForUpdateRef = db.ref(`messages/${chatId}`);
                    
                    messagesForUpdateRef
                        .orderByChild('timestamp')
                        .limitToLast(newUnreadCounts[senderId])
                        .once('value', msgSnapshot => {
                            const updates: {[key: string]: any} = {};
                            msgSnapshot.forEach((child: any) => {
                                const msg = child.val();
                                if (msg.senderId === senderId && msg.status === 'sent') {
                                    updates[`/messages/${chatId}/${child.key}/status`] = 'delivered';
                                }
                            });
                            if (Object.keys(updates).length > 0) {
                                db.ref().update(updates);
                            }
                        });
                }
            });
        });

        // Listen for call logs
        const callLogsRef = db.ref(`callLogs/${userProfile.uid}`).orderByChild('timestamp').limitToLast(50);
        callLogsRef.on('value', (snapshot: any) => {
            if (snapshot.exists()) {
                const logs: CallLog[] = [];
                snapshot.forEach((childSnapshot: any) => {
                    logs.push({id: childSnapshot.key, ...childSnapshot.val()});
                });
                setCallLogs(logs.reverse());
            } else {
                setCallLogs([]);
            }
        });
        
        // Listen for incoming calls
        const callsRef = db.ref(`calls/${userProfile.uid}`);
        callsRef.on('value', (snapshot: any) => {
            if (snapshot.exists()) {
                const callData = snapshot.val() as CallData;
                if (userProfile.blocked && userProfile.blocked[callData.callerId]) {
                    db.ref(`calls/${userProfile.uid}`).remove();
                    return;
                }
                if (callData.status === 'ringing') {
                    setIncomingCall(callData);
                    showModal('incoming-call');
                    ringtoneRef.current?.play();
                }
            } else {
                setIncomingCall(null);
                showModal('none');
                ringtoneRef.current?.pause();
            }
        });

        // Listen for blocked users list to display in profile
        const blockedRef = db.ref(`users/${userProfile.uid}/blocked`);
        blockedRef.on('value', (snapshot: any) => {
            if (snapshot.exists()) {
                const blockedUids = Object.keys(snapshot.val());
                const blockedPromises = blockedUids.map(uid => 
                    db.ref(`users/${uid}`).once('value')
                );
                Promise.all(blockedPromises).then(blockedSnapshots => {
                    const fetchedBlockedUsers = blockedSnapshots.map(snap => {
                        const profile = snap.val();
                        if (!profile) return null;
                        return { uid: profile.uid, name: profile.name, emoji: profile.emoji };
                    }).filter(Boolean) as BlockedUser[];
                    setBlockedUsers(fetchedBlockedUsers);
                });
            } else {
                setBlockedUsers([]);
            }
        });

        return () => {
            contactsRef.off();
            requestsRef.off();
            unreadRef.off();
            callsRef.off();
            callLogsRef.off();
            blockedRef.off();
        };
    }, [userProfile]);
    
    // --- Message Listeners ---
    useEffect(() => {
        if (!userProfile || !currentChatPartner) {
            setMessages([]);
            return;
        }
        
        const chatMembers = [userProfile.uid, currentChatPartner.uid].sort();
        const chatId = chatMembers.join('_');
        const messagesRef = db.ref(`messages/${chatId}`).orderByChild('timestamp').limitToLast(100);

        messagesRef.on('value', (snapshot: any) => {
            const loadedMessages: Message[] = [];
            const updates: { [key: string]: any } = {};
            if (snapshot.exists()) {
                snapshot.forEach((childSnapshot: any) => {
                    const msgData = childSnapshot.val();
                    loadedMessages.push({ id: childSnapshot.key, ...msgData });
                    
                    // If I am the recipient and the message isn't read, mark it as read.
                    if (msgData.senderId === currentChatPartner.uid && msgData.status !== 'read') {
                        updates[`/messages/${chatId}/${childSnapshot.key}/status`] = 'read';
                    }
                });
            }
            setMessages(loadedMessages);

            if (Object.keys(updates).length > 0) {
                db.ref().update(updates);
            }
        });

        // Clear unread count
        db.ref(`unreadCounts/${userProfile.uid}/${currentChatPartner.uid}`).remove();

        return () => messagesRef.off();

    }, [currentChatPartner, userProfile]);

    const handleSendMessage = (text: string) => {
        if (!userProfile || !currentChatPartner || !text.trim()) return;

        const chatMembers = [userProfile.uid, currentChatPartner.uid].sort();
        const chatId = chatMembers.join('_');
        const messagesRef = db.ref(`messages/${chatId}`);
        
        const newMessage: Omit<Message, 'id'> = {
            senderId: userProfile.uid,
            text,
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            status: 'sent'
        };
        messagesRef.push(newMessage);

        // Increment unread count for recipient
        const unreadRef = db.ref(`unreadCounts/${currentChatPartner.uid}/${userProfile.uid}`);
        unreadRef.transaction((currentCount) => (currentCount || 0) + 1);

        // NOTE: This queues a notification request. A backend process (e.g., a Firebase Cloud Function)
        // is required to listen to this queue, fetch the recipient's FCM token, and send the notification.
        const notificationPayload = {
            recipientUid: currentChatPartner.uid,
            title: userProfile.name,
            body: text.length > 50 ? `${text.substring(0, 47)}...` : text,
            data: {
                type: 'new_message',
                senderId: userProfile.uid,
            },
        };
        db.ref('notificationsQueue').push(notificationPayload);
    };

    // --- Call Timer ---
    useEffect(() => {
        let interval: ReturnType<typeof setTimeout> | null = null;
        if (callStartTime) {
            interval = setInterval(() => {
                const seconds = Math.floor((Date.now() - callStartTime) / 1000);
                const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
                const secs = (seconds % 60).toString().padStart(2, '0');
                setCallDuration(`${mins}:${secs}`);
            }, 1000);
        }
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [callStartTime]);

    // --- WebRTC Call Logic ---

    const getDevices = useCallback(async () => {
        try {
            const deviceInfos = await navigator.mediaDevices.enumerateDevices();
            const audioInput = deviceInfos.filter(d => d.kind === 'audioinput');
            const videoInput = deviceInfos.filter(d => d.kind === 'videoinput');
            const audioOutput = deviceInfos.filter(d => d.kind === 'audiooutput');
            setDevices({ audioInput, videoInput, audioOutput });
        } catch (error) {
            console.error("Error enumerating devices:", error);
        }
    }, []);

    const handleDeviceChange = useCallback(async (type: 'audioInput' | 'videoInput' | 'audioOutput', deviceId: string) => {
        if (type === 'audioOutput') {
            setSelectedDeviceIds(prev => ({ ...prev, audioOutputId: deviceId }));
            const videoElement = remoteVideoRef.current || remoteAudioRef.current;
            if (videoElement && (videoElement as any).setSinkId) {
                try {
                    await (videoElement as any).setSinkId(deviceId);
                } catch (error) {
                    console.error("Error setting sink ID:", error);
                }
            }
            return;
        }

        if (!localStreamRef.current || !peerConnectionRef.current) return;

        // Get current constraints
        const newVideoInputId = type === 'videoInput' ? deviceId : selectedDeviceIds.videoInputId;
        const newAudioInputId = type === 'audioInput' ? deviceId : selectedDeviceIds.audioInputId;

        // Stop current tracks
        localStreamRef.current.getTracks().forEach(track => track.stop());

        try {
            // Get new stream with new device
            const newStream = await navigator.mediaDevices.getUserMedia({
                audio: { deviceId: { exact: newAudioInputId } },
                video: callView === 'video-call' ? { deviceId: { exact: newVideoInputId } } : false
            });

            // Update local state and refs
            localStreamRef.current = newStream;
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = newStream;
            }
            setSelectedDeviceIds(prev => ({ ...prev, audioInputId: newAudioInputId, videoInputId: newVideoInputId }));

            // Replace tracks in peer connection
            const audioTrack = newStream.getAudioTracks()[0];
            const videoTrack = newStream.getVideoTracks()[0];

            const audioSender = peerConnectionRef.current.getSenders().find(s => s.track?.kind === 'audio');
            if (audioSender && audioTrack) {
                audioSender.replaceTrack(audioTrack);
            }

            const videoSender = peerConnectionRef.current.getSenders().find(s => s.track?.kind === 'video');
            if (videoSender && videoTrack) {
                videoSender.replaceTrack(videoTrack);
            }
        } catch (error) {
            console.error("Error changing device:", error);
        }
    }, [callView, selectedDeviceIds]);

    const createPeerConnection = useCallback((callId: string, isCaller: boolean) => {
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                const path = isCaller ? `iceCandidates/${callId}/caller` : `iceCandidates/${callId}/callee`;
                db.ref(path).push(event.candidate.toJSON());
            }
        };

        pc.ontrack = (event) => {
            if (event.streams && event.streams[0]) {
                remoteStreamRef.current = event.streams[0];
                if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = event.streams[0];
                }
                if (remoteAudioRef.current) {
                    remoteAudioRef.current.srcObject = event.streams[0];
                }
            }
        };

        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => {
                pc.addTrack(track, localStreamRef.current!);
            });
        }
        
        peerConnectionRef.current = pc;
    }, []);

    const endCall = useCallback(async () => {
        if (peerConnectionRef.current) {
            peerConnectionRef.current.close();
            peerConnectionRef.current = null;
        }
        if (localStreamRef.current) {
            localStreamRef.current.getTracks().forEach(track => track.stop());
            localStreamRef.current = null;
        }
        
        if (currentCall) {
            const callRef = db.ref(`calls/${currentCall.calleeId}`);
            callRef.remove();
            const iceRef = db.ref(`iceCandidates/${currentCall.callId}`);
            iceRef.remove();
        }

        setCallView('none');
        setCurrentCall(null);
        setIsMuted(false);
        setIsCameraOff(false);
        originalVideoTrackRef.current = null;
        setCallStartTime(null);
        setCallDuration('00:00');
    }, [currentCall]);
    
    const startCall = useCallback(async (callee: UserProfile, type: 'video' | 'voice') => {
        if (!userProfile) return;
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: type === 'video',
                audio: true
            });
            localStreamRef.current = stream;
            // Set initial selected devices
            const audioTrack = stream.getAudioTracks()[0];
            const videoTrack = stream.getVideoTracks()[0];
            setSelectedDeviceIds({
                audioInputId: audioTrack?.getSettings().deviceId || '',
                videoInputId: videoTrack?.getSettings().deviceId || '',
                audioOutputId: 'default'
            });

            if (localVideoRef.current) localVideoRef.current.srcObject = stream;
            
            const callId = db.ref().push().key;
            const newCallData: CallData = {
                callId,
                callerId: userProfile.uid,
                calleeId: callee.uid,
                callerName: userProfile.name,
                callerEmoji: userProfile.emoji,
                type,
                offer: {} as RTCSessionDescriptionInit,
                status: 'ringing'
            };
            
            createPeerConnection(callId, true);
            const offer = await peerConnectionRef.current!.createOffer();
            await peerConnectionRef.current!.setLocalDescription(offer);
            
            newCallData.offer = offer;
            setCurrentCall(newCallData);

            await db.ref(`calls/${callee.uid}`).set(newCallData);
            
            // Queue a notification request for the call
            const callNotificationPayload = {
                recipientUid: callee.uid,
                title: `Incoming ${type} call`,
                body: `${userProfile.name} is calling you.`,
                data: {
                    type: 'incoming_call',
                    callId: newCallData.callId,
                }
            };
            db.ref(`notificationsQueue`).push(callNotificationPayload);


            // Listen for answer
            db.ref(`calls/${callee.uid}`).on('value', async (snapshot: any) => {
                const data = snapshot.val() as CallData;
                if (data && data.answer && !peerConnectionRef.current?.remoteDescription) {
                    const answerDescription = new RTCSessionDescription(data.answer);
                    await peerConnectionRef.current?.setRemoteDescription(answerDescription);
                     if (data.status === 'answered') {
                        setCallStartTime(Date.now());
                    }
                }
                if(!data) { // Call declined or ended
                    endCall();
                }
            });

            // Listen for callee's ICE candidates
            db.ref(`iceCandidates/${callId}/callee`).on('child_added', (snapshot: any) => {
                const candidate = new RTCIceCandidate(snapshot.val());
                peerConnectionRef.current?.addIceCandidate(candidate);
            });

            setCallView(type === 'video' ? 'video-call' : 'voice-call');

        } catch (error) {
            console.error("Error starting call:", error);
        }
    }, [userProfile, createPeerConnection, endCall]);

    const answerCall = useCallback(async () => {
        if (!incomingCall || !userProfile) return;
        
        showModal('none');
        ringtoneRef.current?.pause();
        
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: incomingCall.type === 'video',
                audio: true,
            });
            localStreamRef.current = stream;
            // Set initial selected devices
            const audioTrack = stream.getAudioTracks()[0];
            const videoTrack = stream.getVideoTracks()[0];
            setSelectedDeviceIds({
                audioInputId: audioTrack?.getSettings().deviceId || '',
                videoInputId: videoTrack?.getSettings().deviceId || '',
                audioOutputId: 'default'
            });

            if (localVideoRef.current) localVideoRef.current.srcObject = stream;

            createPeerConnection(incomingCall.callId, false);

            await peerConnectionRef.current!.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
            const answer = await peerConnectionRef.current!.createAnswer();
            await peerConnectionRef.current!.setLocalDescription(answer);

            const callRef = db.ref(`calls/${incomingCall.calleeId}`);
            await callRef.update({ answer: answer, status: 'answered' });
            
            // Set current call after updating status to ensure timer starts correctly
            setCurrentCall({ ...incomingCall, status: 'answered' });
            setCallStartTime(Date.now());

            db.ref(`iceCandidates/${incomingCall.callId}/caller`).on('child_added', (snapshot: any) => {
                const candidate = new RTCIceCandidate(snapshot.val());
                peerConnectionRef.current?.addIceCandidate(candidate);
            });

            setCallView(incomingCall.type === 'video' ? 'video-call' : 'voice-call');
            
        } catch (error) {
            console.error("Error answering call:", error);
        }
    }, [incomingCall, userProfile, createPeerConnection]);

    const rejectCall = useCallback(() => {
        if (!incomingCall) return;
        db.ref(`calls/${incomingCall.calleeId}`).remove();
        showModal('none');
        ringtoneRef.current?.pause();
        setIncomingCall(null);
    }, [incomingCall]);

    const toggleMute = () => {
        if (localStreamRef.current) {
            const audioTrack = localStreamRef.current.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                setIsMuted(!audioTrack.enabled);
            }
        }
    };

    const toggleCamera = () => {
        if (localStreamRef.current) {
            const videoTrack = localStreamRef.current.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                setIsCameraOff(!videoTrack.enabled);
            }
        }
    };

    const startScreenShare = async () => {
        if (!peerConnectionRef.current || !localStreamRef.current) return;

        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = screenStream.getVideoTracks()[0];
            
            const videoSender = peerConnectionRef.current.getSenders().find(sender => sender.track?.kind === 'video');
            
            if (videoSender) {
                originalVideoTrackRef.current = localStreamRef.current.getVideoTracks()[0];
                videoSender.replaceTrack(screenTrack);
            }

            screenTrack.onended = () => {
                if (videoSender && originalVideoTrackRef.current) {
                    videoSender.replaceTrack(originalVideoTrackRef.current);
                    originalVideoTrackRef.current.enabled = !isCameraOff;
                }
            };
        } catch (error) {
            console.error("Screen sharing failed:", error);
        }
    };

    // --- Component Rendering ---
    return (
        <div id="app-container" className="relative w-full max-w-[450px] h-full max-h-[950px] bg-[#f0f2f5] shadow-2xl rounded-lg overflow-hidden flex flex-col font-sans">
             <audio id="ringtone" loop ref={ringtoneRef} src="data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA="></audio>

            {view === 'auth' && <AuthView />}
            {view === 'main' && userProfile && (
                <MainView
                    userProfile={userProfile}
                    contacts={contacts}
                    requests={friendRequests}
                    callLogs={callLogs}
                    unreadCounts={unreadCounts}
                    notificationPermission={notificationPermission}
                    onRequestNotificationPermission={requestNotificationPermission}
                    onContactClick={(contact) => {
                        const partnerProfile = {
                            uid: contact.uid,
                            name: contact.name,
                            emoji: contact.emoji,
                            // These are placeholders as we don't fetch all details for contacts list
                            email: '', 
                            customId: ''
                        };
                        setCurrentChatPartner(partnerProfile);
                        showView('chat');
                    }}
                    onAddFriend={() => showModal('add-friend')}
                    onProfile={() => showModal('profile-view')}
                    onBlockUser={handleBlockUser}
                />
            )}
            {view === 'chat' && userProfile && currentChatPartner && (
                <ChatView 
                    currentUser={userProfile}
                    chatPartner={currentChatPartner}
                    messages={messages}
                    onBack={() => showView('main')}
                    onSendMessage={handleSendMessage}
                    onStartCall={startCall}
                />
            )}

            {callView !== 'none' && currentCall && (
                 <div className="absolute inset-0 z-50">
                    <CallView 
                        type={callView}
                        partnerName={currentCall.callerId === userProfile?.uid ? (contacts.find(c=>c.uid === currentCall.calleeId)?.name || t('unknown')) : currentCall.callerName}
                        partnerEmoji={currentCall.callerId === userProfile?.uid ? (contacts.find(c=>c.uid === currentCall.calleeId)?.emoji || '🤔') : currentCall.callerEmoji}
                        localVideoRef={localVideoRef}
                        remoteVideoRef={remoteVideoRef}
                        remoteAudioRef={remoteAudioRef}
                        isMuted={isMuted}
                        isCameraOff={isCameraOff}
                        onToggleMute={toggleMute}
                        onToggleCamera={toggleCamera}
                        onStartScreenShare={startScreenShare}
                        onEndCall={() => setIsEndCallModalVisible(true)}
                        onOpenSettings={() => {
                            getDevices();
                            showModal('device-settings');
                        }}
                        callStatus={currentCall.status}
                        callDuration={callDuration}
                    />
                 </div>
            )}
            
            {modal === 'profile-setup' && currentUser && <ProfileSetupModal user={currentUser} onClose={() => auth.signOut()} />}
            {modal === 'add-friend' && userProfile && <AddFriendModal currentUserProfile={userProfile} onClose={() => showModal('none')} />}
            {modal === 'profile-view' && userProfile && <ProfileViewModal userProfile={userProfile} blockedUsers={blockedUsers} onUnblockUser={handleUnblockUser} onLogout={handleLogout} onClose={() => showModal('none')} />}
            {modal === 'incoming-call' && incomingCall && (
                <IncomingCallModal 
                    callData={incomingCall}
                    onAccept={answerCall}
                    onReject={rejectCall}
                />
            )}
            {modal === 'device-settings' && (
                <DeviceSettingsModal
                    devices={devices}
                    selectedDevices={selectedDeviceIds}
                    onDeviceChange={handleDeviceChange}
                    onClose={() => showModal('none')}
                    callType={callView}
                />
            )}
            {isEndCallModalVisible && (
                <EndCallConfirmationModal
                    onConfirm={() => {
                        endCall();
                        setIsEndCallModalVisible(false);
                    }}
                    onCancel={() => setIsEndCallModalVisible(false)}
                />
            )}
        </div>
    );
};

// --- Sub-Components (defined in the same file for simplicity) ---

const AuthView: React.FC = () => {
    const { t } = useI18n();
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        try {
            if (isLogin) {
                await auth.signInWithEmailAndPassword(email, password);
            } else {
                await auth.createUserWithEmailAndPassword(email, password);
            }
        } catch (err: any) {
            setError(err.message);
        }
    };
    
    return (
        <div id="auth-view" className="flex flex-col items-center justify-center h-full p-8 bg-white">
            <h1 className="text-4xl font-bold text-[#005c97] mb-8">{t('appTitle')}</h1>
            <form onSubmit={handleSubmit} className="w-full">
                <input type="email" placeholder={t('email')} value={email} onChange={e => setEmail(e.target.value)} className="w-full p-3 mb-4 border border-[#e9edef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#34B7F1]" required />
                <input type="password" placeholder={t('password')} value={password} onChange={e => setPassword(e.target.value)} className="w-full p-3 mb-4 border border-[#e9edef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#34B7F1]" required />
                {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
                <button type="submit" className="w-full bg-[#008069] text-white p-3 rounded-lg font-semibold hover:bg-opacity-90 transition-colors">
                    {isLogin ? t('login') : t('signup')}
                </button>
            </form>
            <button onClick={() => setIsLogin(!isLogin)} className="mt-4 text-[#00a8e8] hover:underline">
                {isLogin ? t('needAccount') : t('haveAccount')}
            </button>
        </div>
    );
};

const NotificationPermissionBanner: React.FC<{ permission: string; onRequest: () => void }> = ({ permission, onRequest }) => {
    const { t } = useI18n();

    if (permission === 'granted' || !messaging) {
        return null;
    }

    return (
        <div className="p-2 bg-yellow-100 border-b border-yellow-300 text-yellow-800 text-sm">
            {permission === 'denied' ? (
                <p className="text-center">{t('notificationsBlocked')}</p>
            ) : (
                <div className="flex justify-between items-center">
                    <p>{t('getNotified')}</p>
                    <button onClick={onRequest} className="bg-yellow-400 hover:bg-yellow-500 text-white font-bold py-1 px-3 rounded">
                        {t('enable')}
                    </button>
                </div>
            )}
        </div>
    );
};


const MainView: React.FC<{
    userProfile: UserProfile, 
    contacts: Contact[],
    requests: FriendRequest[],
    callLogs: CallLog[],
    unreadCounts: {[key: string]: number},
    notificationPermission: string,
    onRequestNotificationPermission: () => void,
    onContactClick: (contact: Contact) => void,
    onAddFriend: () => void,
    onProfile: () => void,
    onBlockUser: (uid: string) => void,
}> = ({ userProfile, contacts, requests, callLogs, unreadCounts, notificationPermission, onRequestNotificationPermission, onContactClick, onAddFriend, onProfile, onBlockUser }) => {
    const { t } = useI18n();
    const [activeTab, setActiveTab] = useState('chats');
    const [searchQuery, setSearchQuery] = useState('');

    // --- Progress Bar Logic ---
    const tasks = {
        hasContacts: contacts.length > 0,
        hasClearedRequests: requests.length === 0,
        hasMadeCall: callLogs.length > 0,
    };
    const completedTasks = Object.values(tasks).filter(Boolean).length;
    const totalTasks = Object.keys(tasks).length;
    const progressPercentage = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 100;

    const totalUnread = Object.values(unreadCounts).reduce((sum, count) => sum + count, 0);

    const filteredContacts = contacts.filter(contact =>
        contact.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleAcceptRequest = (request: FriendRequest) => {
        const myUid = userProfile.uid;
        const theirUid = request.fromId;
        const updates: {[key: string]: any} = {};
        updates[`/users/${myUid}/contacts/${theirUid}`] = true;
        updates[`/users/${theirUid}/contacts/${myUid}`] = true;
        updates[`/requests/${myUid}/${theirUid}`] = null;
        db.ref().update(updates);
    };

    const handleRejectRequest = (request: FriendRequest) => {
        db.ref(`requests/${userProfile.uid}/${request.fromId}`).remove();
    };
    
    return (
        <div id="main-view" className="flex flex-col h-full w-full">
            <header className="main-header bg-[#005c97] text-white shadow-md">
                <div className="header-top flex justify-between items-center p-3">
                    <h1 className="text-xl font-semibold">{t('chattingApp')}</h1>
                    <div className="flex items-center space-x-2">
                        <button onClick={onAddFriend} className="icon-btn p-2 rounded-full hover:bg-white/20"><AddFriendIcon /></button>
                        <button onClick={onProfile} className="icon-btn p-2 rounded-full hover:bg-white/20"><MenuIcon /></button>
                    </div>
                </div>
                <nav className="header-nav flex justify-around">
                    <button id="nav-home" onClick={() => setActiveTab('chats')} className={`nav-tab flex-1 py-3 text-sm font-bold relative ${activeTab === 'chats' ? 'text-white border-b-4 border-[#34B7F1]' : 'text-gray-300'}`}>
                        {t('chats')} {totalUnread > 0 && <span className="badge absolute top-2 ml-1 bg-green-500 text-white text-xs rounded-full px-1.5 py-0.5">{totalUnread}</span>}
                    </button>
                     <button id="nav-notifications" onClick={() => setActiveTab('updates')} className={`nav-tab flex-1 py-3 text-sm font-bold relative ${activeTab === 'updates' ? 'text-white border-b-4 border-[#34B7F1]' : 'text-gray-300'}`}>
                        {t('updates')} {requests.length > 0 && <span className="badge absolute top-2 ml-1 bg-green-500 text-white text-xs rounded-full px-1.5 py-0.5">{requests.length}</span>}
                    </button>
                    <button id="nav-calls" onClick={() => setActiveTab('calls')} className={`nav-tab flex-1 py-3 text-sm font-bold ${activeTab === 'calls' ? 'text-white border-b-4 border-[#34B7F1]' : 'text-gray-300'}`}>
                        {t('calls')}
                    </button>
                </nav>
            </header>
            
            <NotificationPermissionBanner permission={notificationPermission} onRequest={onRequestNotificationPermission} />

            {progressPercentage < 100 && (
                 <div className="p-3 bg-white border-b border-gray-200">
                    <div className="flex justify-between items-center mb-1">
                        <p className="text-sm font-semibold text-gray-700">{t('tasksProgress')}</p>
                        <p className="text-sm font-bold text-[#005c97]">{`${completedTasks}/${totalTasks}`}</p>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                            className="bg-[#34B7F1] h-2 rounded-full transition-all duration-500" 
                            style={{ width: `${progressPercentage}%` }}
                        ></div>
                    </div>
                </div>
            )}

            <main id="main-content" className="flex-1 overflow-y-auto">
                {activeTab === 'chats' && <div id="home-content" className="content-panel">
                    <div className="p-2 border-b border-[#e9edef] bg-white">
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-500">
                                <SearchIcon />
                            </div>
                            <input
                                type="text"
                                placeholder={t('searchContacts')}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="block w-full bg-gray-100 rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[#34B7F1]"
                            />
                        </div>
                    </div>
                    {filteredContacts.map(contact => (
                         <div key={contact.uid} className="list-item flex items-center p-3 hover:bg-gray-100 border-b border-[#e9edef]">
                            <div onClick={() => onContactClick(contact)} className="flex items-center flex-1 cursor-pointer">
                                <div className="text-3xl mr-4">{contact.emoji}</div>
                                <div className="flex-1">
                                    <p className="font-semibold text-gray-800">{contact.name}</p>
                                </div>
                            </div>
                             {unreadCounts[contact.uid] && <span className="bg-green-500 text-white text-xs rounded-full px-2 py-1 mr-2">{unreadCounts[contact.uid]}</span>}
                             <button onClick={() => onBlockUser(contact.uid)} title={t('blockUser', { name: contact.name })} className="p-2 text-gray-400 hover:text-red-500 rounded-full focus:outline-none focus:ring-2 focus:ring-red-400">
                                <BlockIcon />
                            </button>
                        </div>
                    ))}
                </div>}
                 {activeTab === 'updates' && <div id="notifications-content" className="content-panel p-2">
                    <h2 className="p-2 font-semibold text-gray-600">{t('friendRequests')}</h2>
                    {requests.length > 0 ? requests.map(req => (
                        <div key={req.fromId} className="list-item flex items-center p-3 bg-white rounded-lg mb-2 shadow-sm">
                            <div className="text-3xl mr-4">{req.fromEmoji}</div>
                            <div className="flex-1">
                                <p className="font-semibold text-gray-800">{req.fromName}</p>
                                <p className="text-sm text-gray-500">{t('wantsToConnect')}</p>
                            </div>
                            <div className="flex space-x-2">
                                <button onClick={() => handleAcceptRequest(req)} className="bg-green-500 text-white px-3 py-1 rounded-md text-sm">{t('accept')}</button>
                                <button onClick={() => handleRejectRequest(req)} className="bg-gray-200 text-gray-700 px-3 py-1 rounded-md text-sm">{t('decline')}</button>
                            </div>
                        </div>
                    )) : <p className="text-center text-gray-500 p-4">{t('noNewUpdates')}</p>}
                </div>}
                {activeTab === 'calls' && <div id="calls-content" className="content-panel">
                     {callLogs.map(log => (
                        <div key={log.id} className="list-item flex items-center p-3 border-b border-[#e9edef]">
                            <div className="text-3xl mr-4">{log.partnerEmoji}</div>
                            <div className="flex-1">
                                <p className="font-semibold text-gray-800">{log.partnerName}</p>
                                <p className="text-sm text-gray-500 capitalize">{t('callLogDetail', { direction: t(log.direction), type: t(log.type) })}</p>
                            </div>
                            <p className="text-xs text-gray-400">{new Date(log.timestamp).toLocaleTimeString()}</p>
                        </div>
                    ))}
                </div>}
            </main>
        </div>
    );
};

const MessageStatusIndicator: React.FC<{ status?: 'sent' | 'delivered' | 'read' }> = ({ status }) => {
    if (!status) return null;
    switch (status) {
        case 'read':
            return <ReadIcon />;
        case 'delivered':
            return <DeliveredIcon />;
        case 'sent':
        default:
            return <SentIcon />;
    }
};

const ChatView: React.FC<{
    currentUser: UserProfile, 
    chatPartner: UserProfile,
    messages: Message[],
    onBack: () => void,
    onSendMessage: (text: string) => void,
    onStartCall: (callee: UserProfile, type: 'video' | 'voice') => void
}> = ({ currentUser, chatPartner, messages, onBack, onSendMessage, onStartCall }) => {
    const { t } = useI18n();
    const [inputText, setInputText] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);
    
    const handleSendClick = () => {
        onSendMessage(inputText);
        setInputText('');
    };
    
    return (
        <div id="chat-view" className="flex flex-col h-full w-full bg-[#e5ddd5]">
            <header className="chat-header flex items-center p-2 bg-[#005c97] text-white shadow-md z-10">
                <button onClick={onBack} className="icon-btn p-2 rounded-full hover:bg-white/20"><BackIcon /></button>
                <div className="text-2xl mx-2">{chatPartner.emoji}</div>
                <h2 className="font-semibold flex-1">{chatPartner.name}</h2>
                <div className="flex items-center space-x-1">
                    <button onClick={() => onStartCall(chatPartner, 'voice')} className="icon-btn p-2 rounded-full hover:bg-white/20"><VoiceCallIcon /></button>
                    <button onClick={() => onStartCall(chatPartner, 'video')} className="icon-btn p-2 rounded-full hover:bg-white/20"><VideoCallIcon /></button>
                    <button className="icon-btn p-2 rounded-full hover:bg-white/20"><MenuIcon /></button>
                </div>
            </header>
            <div 
                id="chat-messages" 
                className="flex-1 overflow-y-auto p-4"
                style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23bdbdbd' fill-opacity='0.15' fill-rule='evenodd'%3E%3Cpath d='M0 40L40 0H20L0 20M40 40V20L20 40'/%3E%3C/g%3E%3C/svg%3E")`
                }}
            >
                {messages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.senderId === currentUser.uid ? 'justify-end' : 'justify-start'}`}>
                        <div className={`message-bubble max-w-xs md:max-w-md p-2 px-3 rounded-lg mb-2 shadow ${msg.senderId === currentUser.uid ? 'bg-[#e1f6fb] rounded-br-none' : 'bg-white rounded-bl-none'}`}>
                            <p className="text-sm text-gray-800 break-words">{msg.text}</p>
                            <div className="flex items-center justify-end text-xs text-gray-400 mt-1">
                                <span>{new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                {msg.senderId === currentUser.uid && <MessageStatusIndicator status={msg.status} />}
                            </div>
                        </div>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>
            <div id="chat-input-container" className="p-2 bg-gray-100 border-t border-[#e9edef] flex items-center">
                <input 
                    id="chat-input" 
                    type="text" 
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSendClick()}
                    placeholder={t('typeMessage')} 
                    className="flex-1 p-2 bg-white rounded-full border-transparent focus:outline-none focus:ring-2 focus:ring-[#34B7F1]" 
                />
                <button id="chat-send-btn" onClick={handleSendClick} className="ml-2 bg-[#008069] text-white rounded-full p-3 hover:bg-opacity-90 transition-colors">
                    <SendIcon />
                </button>
            </div>
        </div>
    );
};

const CallView: React.FC<{
    type: 'video-call' | 'voice-call' | 'none',
    partnerName: string,
    partnerEmoji: string,
    localVideoRef: React.RefObject<HTMLVideoElement>,
    remoteVideoRef: React.RefObject<HTMLVideoElement>,
    remoteAudioRef: React.RefObject<HTMLAudioElement>,
    isMuted: boolean,
    isCameraOff: boolean,
    onToggleMute: () => void,
    onToggleCamera: () => void,
    onStartScreenShare: () => void,
    onEndCall: () => void,
    onOpenSettings: () => void,
    callStatus: 'ringing' | 'answered' | 'declined' | 'ended',
    callDuration: string
}> = ({ type, partnerName, partnerEmoji, localVideoRef, remoteVideoRef, remoteAudioRef, isMuted, isCameraOff, onToggleMute, onToggleCamera, onStartScreenShare, onEndCall, onOpenSettings, callStatus, callDuration }) => {
    const { t } = useI18n();
    const [showControls, setShowControls] = useState(true);
    const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const toggleControlsVisibility = () => {
        if (type === 'video-call') {
            setShowControls(prev => !prev);
        }
    };

    useEffect(() => {
        if (type === 'video-call' && showControls) {
            controlsTimeoutRef.current = setTimeout(() => {
                setShowControls(false);
            }, 4000);
        } else {
            if (controlsTimeoutRef.current) {
                clearTimeout(controlsTimeoutRef.current);
            }
        }
        return () => {
            if (controlsTimeoutRef.current) {
                clearTimeout(controlsTimeoutRef.current);
            }
        };
    }, [showControls, type]);

    if (type === 'none') return null;

    return (
        <div 
            id={type === 'video-call' ? 'video-call-view' : 'voice-call-view'} 
            className="call-view absolute inset-0 bg-gray-900 flex flex-col items-center justify-center text-white select-none"
            onClick={toggleControlsVisibility}
        >
            {/* Background and info for voice call */}
            {type === 'voice-call' && (
                <>
                    <div className="absolute inset-0 bg-gray-800 pulse-bg z-0"></div>
                    <div className="z-10 flex flex-col items-center text-center">
                        <div className="text-8xl mb-4 p-4 bg-black/20 rounded-full">{partnerEmoji}</div>
                        <p className="text-3xl font-semibold">{partnerName}</p>
                    </div>
                </>
            )}

            {/* Video elements for video call */}
            {type === 'video-call' && (
                <>
                    <video id="remote-video" ref={remoteVideoRef} autoPlay playsInline className="absolute top-0 left-0 w-full h-full object-cover z-0"></video>
                    <video id="local-video" ref={localVideoRef} autoPlay playsInline muted className="absolute bottom-28 right-6 w-28 h-40 object-cover rounded-lg shadow-2xl border-2 border-white/50 cursor-move z-20"></video>
                </>
            )}

            <audio id="remote-audio" ref={remoteAudioRef} autoPlay></audio>
            
            <div 
                className={`absolute top-0 left-0 right-0 p-4 pt-6 bg-gradient-to-b from-black/60 to-transparent z-10 transition-opacity duration-300 ${type === 'video-call' && !showControls ? 'opacity-0' : 'opacity-100'}`}
            >
                <div className="text-center">
                    {type === 'video-call' && <p className="text-2xl font-bold">{partnerName}</p>}
                    <p className="text-md font-mono tracking-wider">
                        {callStatus === 'answered' ? callDuration : t('ringing')}
                    </p>
                </div>
            </div>

            <div 
                 className={`absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/70 to-transparent z-20 transition-opacity duration-300 ${type === 'video-call' && !showControls ? 'opacity-0' : 'opacity-100'}`}
            >
                <div className="call-controls flex items-center justify-center space-x-4">
                    <button onClick={onToggleMute} className="bg-white/20 hover:bg-white/30 text-white rounded-full p-3 transition-colors">
                        {isMuted ? <UnmuteIcon /> : <MuteIcon />}
                    </button>
                    {type === 'video-call' && (
                        <button onClick={onToggleCamera} className="bg-white/20 hover:bg-white/30 text-white rounded-full p-3 transition-colors">
                            {isCameraOff ? <CameraOffIcon /> : <CameraOnIcon />}
                        </button>
                    )}
                    <button onClick={onEndCall} className="bg-red-600 hover:bg-red-700 text-white rounded-full p-4 mx-2 transition-transform hover:scale-110">
                        <EndCallIcon />
                    </button>
                    {type === 'video-call' && (
                         <button onClick={onStartScreenShare} className="bg-white/20 hover:bg-white/30 text-white rounded-full p-3 transition-colors">
                            <ScreenShareIcon />
                        </button>
                    )}
                     <button onClick={onOpenSettings} className="bg-white/20 hover:bg-white/30 text-white rounded-full p-3 transition-colors">
                        <SettingsIcon />
                    </button>
                </div>
            </div>
        </div>
    );
};


// --- Modal Components ---

const ModalWrapper: React.FC<{ title: string; children: React.ReactNode, onClose?: () => void }> = ({ title, children, onClose }) => (
    <div className="modal absolute inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="modal-content bg-white rounded-lg shadow-xl p-6 w-11/12 max-w-sm">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-gray-800">{title}</h2>
                {onClose && <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-2xl">&times;</button>}
            </div>
            {children}
        </div>
    </div>
);

const ProfileSetupModal: React.FC<{ user: any, onClose: () => void }> = ({ user, onClose }) => {
    const { t } = useI18n();
    const [name, setName] = useState('');
    const [emoji, setEmoji] = useState('😀');
    const [isLoading, setIsLoading] = useState(false);

    const handleSave = () => {
        if (!name.trim() || isLoading) return;
        setIsLoading(true);
        
        const userRef = db.ref(`users/${user.uid}`);
        const newUserProfile: UserProfile = {
            uid: user.uid,
            name,
            email: user.email,
            emoji,
            customId: generateRandomId(),
        };
        userRef.set(newUserProfile).catch(error => {
            console.error("Failed to save profile:", error);
            setIsLoading(false);
        });
    };

    return (
        <ModalWrapper title={t('setupProfileTitle')} onClose={onClose}>
            <input type="text" placeholder={t('yourName')} value={name} onChange={e => setName(e.target.value)} className="w-full p-3 mb-4 border border-[#e9edef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#34B7F1]" />
            <input type="text" placeholder={t('yourEmoji')} value={emoji} onChange={e => setEmoji(e.target.value)} maxLength={2} className="w-full p-3 mb-4 border border-[#e9edef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#34B7F1]" />
            <button 
                onClick={handleSave} 
                disabled={isLoading}
                className="w-full bg-[#008069] text-white p-3 rounded-lg font-semibold hover:bg-opacity-90 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
                {isLoading ? 'Saving...' : t('saveProfile')}
            </button>
        </ModalWrapper>
    );
};

const AddFriendModal: React.FC<{ currentUserProfile: UserProfile, onClose: () => void }> = ({ currentUserProfile, onClose }) => {
    const { t } = useI18n();
    const [friendId, setFriendId] = useState('');
    const [status, setStatus] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleAddFriend = async () => {
        if (!friendId.trim() || isLoading) return;
        
        setIsLoading(true);
        setStatus(''); // Clear previous status messages

        try {
            const usersRef = db.ref('users');
            const query = usersRef.orderByChild('customId').equalTo(friendId.trim().toUpperCase());
            const snapshot = await query.once('value');

            if (snapshot.exists()) {
                const recipientUid = Object.keys(snapshot.val())[0];
                if (recipientUid === currentUserProfile.uid) {
                    setStatus(t('statusCantAddSelf'));
                    return;
                }
                const request: FriendRequest = {
                    fromId: currentUserProfile.uid,
                    fromName: currentUserProfile.name,
                    fromEmoji: currentUserProfile.emoji,
                    timestamp: firebase.database.ServerValue.TIMESTAMP
                };
                await db.ref(`requests/${recipientUid}/${currentUserProfile.uid}`).set(request);
                setStatus(t('statusRequestSent'));
                setTimeout(onClose, 1500);
            } else {
                setStatus(t('statusUserNotFound'));
            }
        } catch (error) {
            console.error("Error adding friend:", error);
            setStatus("An error occurred.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <ModalWrapper title={t('addFriendTitle')} onClose={onClose}>
            <p className="text-sm text-gray-600 mb-4">{t('addFriendDescription')}</p>
            <input type="text" placeholder={t('friendIdPlaceholder')} value={friendId} onChange={e => setFriendId(e.target.value)} className="w-full p-3 mb-4 border border-[#e9edef] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#34B7F1]" />
            <button 
                onClick={handleAddFriend} 
                disabled={isLoading}
                className="w-full bg-[#008069] text-white p-3 rounded-lg font-semibold hover:bg-opacity-90 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
                {isLoading ? t('statusSearching') : t('sendRequest')}
            </button>
            {status && <p className="text-center mt-4 text-sm text-gray-600">{status}</p>}
        </ModalWrapper>
    );
};

const ProfileViewModal: React.FC<{
    userProfile: UserProfile,
    blockedUsers: BlockedUser[],
    onUnblockUser: (uid: string) => void,
    onLogout: () => void,
    onClose: () => void
}> = ({ userProfile, blockedUsers, onUnblockUser, onLogout, onClose }) => {
    const { t, language, setLanguage } = useI18n();
    const [copied, setCopied] = useState(false);
    const [activeTab, setActiveTab] = useState<'general' | 'blocked'>('general');

    const handleCopyId = () => {
        navigator.clipboard.writeText(userProfile.customId).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
        <ModalWrapper title={t('profileSettingsTitle')} onClose={onClose}>
            {/* User Info Card */}
            <div className="flex items-center p-3 bg-gray-100 rounded-lg mb-4">
                <p className="text-6xl">{userProfile.emoji}</p>
                <div className="ml-4">
                    <p className="text-xl font-bold text-gray-800">{userProfile.name}</p>
                    <p className="text-sm text-gray-500">{userProfile.email}</p>
                </div>
            </div>

            {/* User ID Section */}
            <div className="mb-4">
                <label className="text-sm font-semibold text-gray-600 mb-1 block">{t('yourSharableId')}</label>
                <div className="flex items-center bg-gray-100 p-2 rounded-lg">
                    <p className="font-mono text-lg font-semibold tracking-widest flex-1 text-gray-700">{userProfile.customId}</p>
                    <button
                        onClick={handleCopyId}
                        className="ml-2 bg-[#008069] text-white px-3 py-1 rounded-md text-sm font-semibold hover:bg-opacity-90 transition-all flex items-center"
                        style={{ minWidth: '80px', justifyContent: 'center' }}
                    >
                        {copied ? t('copied') : (
                            <>
                                <CopyIcon />
                                <span className="ml-1.5">{t('copy')}</span>
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="border-b border-gray-200 mb-4">
                <nav className="-mb-px flex space-x-6" aria-label="Tabs">
                    <button
                        onClick={() => setActiveTab('general')}
                        className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm ${
                            activeTab === 'general'
                                ? 'border-[#005c97] text-[#005c97]'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                        {t('general')}
                    </button>
                    <button
                        onClick={() => setActiveTab('blocked')}
                        className={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm ${
                            activeTab === 'blocked'
                                ? 'border-[#005c97] text-[#005c97]'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                        }`}
                    >
                        {t('blockedUsers')}
                    </button>
                </nav>
            </div>

            {/* Tab Content */}
            <div className="min-h-[120px]">
                {activeTab === 'general' && (
                    <div>
                        <label className="text-sm font-semibold text-gray-600 mb-2 block">{t('language')}</label>
                        <div className="flex space-x-2">
                            <button 
                                onClick={() => setLanguage('en')}
                                className={`px-4 py-2 rounded-md text-sm font-medium ${language === 'en' ? 'bg-[#005c97] text-white' : 'bg-gray-200 text-gray-700'}`}
                            >
                                English
                            </button>
                             <button 
                                onClick={() => setLanguage('es')}
                                className={`px-4 py-2 rounded-md text-sm font-medium ${language === 'es' ? 'bg-[#005c97] text-white' : 'bg-gray-200 text-gray-700'}`}
                            >
                                Español
                            </button>
                        </div>
                    </div>
                )}
                {activeTab === 'blocked' && (
                     <div className="space-y-2">
                        {blockedUsers.length > 0 ? (
                            <div className="max-h-40 overflow-y-auto pr-2 -mr-2">
                                {blockedUsers.map(blockedUser => (
                                    <div key={blockedUser.uid} className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-gray-50">
                                        <span className="text-gray-800">{blockedUser.emoji} {blockedUser.name}</span>
                                        <button onClick={() => onUnblockUser(blockedUser.uid)} className="text-sm bg-gray-200 text-gray-700 px-3 py-1 rounded-md hover:bg-gray-300">
                                            {t('unblock')}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-gray-500 text-center py-4">{t('noBlockedUsers')}</p>
                        )}
                    </div>
                )}
            </div>

            {/* Logout Button (outside tabs) */}
            <div className="mt-4 pt-4 border-t border-gray-200">
                <button onClick={onLogout} className="w-full bg-red-500 text-white p-3 rounded-lg font-semibold hover:bg-opacity-90">{t('logout')}</button>
            </div>
        </ModalWrapper>
    );
};


const IncomingCallModal: React.FC<{ callData: CallData, onAccept: () => void, onReject: () => void }> = ({ callData, onAccept, onReject }) => {
    const { t } = useI18n();
    return (
        <ModalWrapper title={t('incomingCallTitle')}>
            <div className="text-center">
                <p className="text-6xl mb-2">{callData.callerEmoji}</p>
                <p className="text-xl font-bold">{callData.callerName}</p>
                <p className="text-gray-500 mb-6">{t('isCalling', { name: callData.callerName, type: t(callData.type) })}</p>
                <div className="flex justify-around">
                    <button onClick={onReject} className="bg-red-600 text-white rounded-full p-4"><EndCallIcon /></button>
                    <button onClick={onAccept} className="bg-green-500 text-white rounded-full p-4"><AcceptCallIcon /></button>
                </div>
            </div>
        </ModalWrapper>
    );
};

const DeviceSettingsModal: React.FC<{
    devices: { audioInput: MediaDeviceInfo[], videoInput: MediaDeviceInfo[], audioOutput: MediaDeviceInfo[] };
    selectedDevices: { audioInputId: string, videoInputId: string, audioOutputId: string };
    onDeviceChange: (type: 'audioInput' | 'videoInput' | 'audioOutput', deviceId: string) => void;
    onClose: () => void;
    callType: 'video-call' | 'voice-call' | 'none';
}> = ({ devices, selectedDevices, onDeviceChange, onClose, callType }) => {
    const { t } = useI18n();
    return (
        <ModalWrapper title={t('deviceSettingsTitle')} onClose={onClose}>
            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700">{t('microphone')}</label>
                    <select
                        value={selectedDevices.audioInputId}
                        onChange={e => onDeviceChange('audioInput', e.target.value)}
                        className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                    >
                        {devices.audioInput.map(device => (
                            <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
                        ))}
                    </select>
                </div>
                {callType === 'video-call' && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700">{t('camera')}</label>
                        <select
                            value={selectedDevices.videoInputId}
                            onChange={e => onDeviceChange('videoInput', e.target.value)}
                            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                        >
                            {devices.videoInput.map(device => (
                                <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
                            ))}
                        </select>
                    </div>
                )}
                 <div>
                    <label className="block text-sm font-medium text-gray-700">{t('speaker')}</label>
                    <select
                        value={selectedDevices.audioOutputId}
                        onChange={e => onDeviceChange('audioOutput', e.target.value)}
                        className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                    >
                        {devices.audioOutput.map(device => (
                            <option key={device.deviceId} value={device.deviceId}>{device.label}</option>
                        ))}
                    </select>
                </div>
            </div>
            <div className="mt-6">
                 <button onClick={onClose} className="w-full bg-gray-500 text-white p-2 rounded-lg font-semibold hover:bg-opacity-90">{t('close')}</button>
            </div>
        </ModalWrapper>
    );
};

const EndCallConfirmationModal: React.FC<{ onConfirm: () => void; onCancel: () => void }> = ({ onConfirm, onCancel }) => {
    const { t } = useI18n();
    return (
        <ModalWrapper title={t('endCallConfirmationTitle')} onClose={onCancel}>
            <div className="text-center">
                <p className="text-gray-600 mb-6">{t('endCallConfirmationBody')}</p>
                <div className="flex justify-end space-x-4">
                    <button onClick={onCancel} className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg font-semibold hover:bg-gray-300 transition-colors">
                        {t('endCallConfirmationCancel')}
                    </button>
                    <button onClick={onConfirm} className="bg-red-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-red-700 transition-colors">
                        {t('endCallConfirmationConfirm')}
                    </button>
                </div>
            </div>
        </ModalWrapper>
    );
};

export default App;