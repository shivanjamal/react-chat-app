
export interface UserProfile {
    uid: string;
    name: string;
    email: string;
    emoji: string;
    customId: string;
    fcmToken?: string;
    contacts?: { [uid: string]: boolean };
    blocked?: { [uid: string]: boolean };
}

export interface Message {
    id: string;
    senderId: string;
    text: string;
    timestamp: number;
    status: 'sent' | 'delivered' | 'read';
}

export interface Contact {
    uid: string;
    name: string;
    emoji: string;
}

export interface BlockedUser {
    uid: string;
    name: string;
    emoji: string;
}

export interface CallData {
    callId: string;
    callerId: string;
    calleeId: string;
    callerName: string;
    callerEmoji: string;
    type: 'video' | 'voice';
    offer: RTCSessionDescriptionInit;
    answer?: RTCSessionDescriptionInit;
    status: 'ringing' | 'answered' | 'declined' | 'ended';
}

export interface FriendRequest {
    fromId: string;
    fromName: string;
    fromEmoji: string;
    timestamp: number;
}

export interface CallLog {
    id: string;
    partnerName: string;
    partnerEmoji: string;
    type: 'video' | 'voice';
    direction: 'outgoing' | 'incoming' | 'missed';
    timestamp: number;
}