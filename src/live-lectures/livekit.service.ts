import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, RoomServiceClient, type ParticipantPermission } from 'livekit-server-sdk';
import { TrackSource } from '@livekit/protocol';

export interface LiveKitTokenResult {
  token: string;
  identity: string;
}

/**
 * Thin wrapper around the LiveKit Server SDK.
 * All business authorization happens in LiveLecturesService — this service
 * only knows how to mint tokens and drive the LiveKit room APIs.
 */
@Injectable()
export class LiveKitService {
  private readonly logger = new Logger(LiveKitService.name);
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly serverUrl: string;
  private roomClient: RoomServiceClient | null = null;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('LIVEKIT_API_KEY') || '';
    this.apiSecret = this.config.get<string>('LIVEKIT_API_SECRET') || '';
    this.serverUrl = this.config.get<string>('LIVEKIT_URL') || '';
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiSecret && this.serverUrl);
  }

  /** Public wss URL handed to clients in the /join response. */
  get publicServerUrl(): string {
    return this.serverUrl;
  }

  private requireConfigured(): void {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Live conferencing is not available right now. Please contact support.',
      );
    }
  }

  /** RoomServiceClient needs an http(s) host — convert wss:// if needed. */
  private get rooms(): RoomServiceClient {
    this.requireConfigured();
    if (!this.roomClient) {
      const httpHost = this.serverUrl.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
      this.roomClient = new RoomServiceClient(httpHost, this.apiKey, this.apiSecret);
    }
    return this.roomClient;
  }

  async generateToken(params: {
    identity: string;
    name: string;
    roomName: string;
    canPublish: boolean;
    canSubscribe: boolean;
    roomAdmin: boolean;
    ttlSeconds?: number;
  }): Promise<LiveKitTokenResult> {
    this.requireConfigured();

    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity: params.identity,
      name: params.name,
      ttl: params.ttlSeconds ?? 6 * 60 * 60, // short-lived: max 6 hours
    });

    token.addGrant({
      roomJoin: true,
      room: params.roomName,
      canPublish: params.canPublish,
      canSubscribe: params.canSubscribe,
      canPublishData: true, // chat / raise-hand via data channels
      roomAdmin: params.roomAdmin,
    });

    try {
      return { token: await token.toJwt(), identity: params.identity };
    } catch (err) {
      this.logger.error(`Failed to mint LiveKit token for ${params.identity}: ${String(err)}`);
      throw new ServiceUnavailableException('Could not join the live room. Try again shortly.');
    }
  }

  /** Force-close a room — every connected participant receives Disconnected immediately. */
  async deleteRoom(roomName: string): Promise<void> {
    if (!this.isConfigured) return;
    await this.rooms.deleteRoom(roomName).catch((err) => {
      // Room may already be empty/gone — safe to ignore
      this.logger.warn(`Could not delete LiveKit room ${roomName}: ${String(err)}`);
    });
  }

  async removeParticipant(roomName: string, identity: string): Promise<void> {
    await this.rooms.removeParticipant(roomName, identity).catch((err) => {
      // Participant may have already left — treat "not found" as success
      const msg = String(err?.message || err);
      if (!/not found/i.test(msg)) throw err;
    });
  }

  async muteParticipant(roomName: string, identity: string): Promise<void> {
    const participant = await this.findParticipant(roomName, identity);
    if (!participant) return;

    const tracks = participant.tracks ?? [];
    await Promise.all(
      tracks
        .filter((t) => !t.muted)
        .map((t) =>
          this.rooms
            .mutePublishedTrack(roomName, identity, t.sid, true)
            .catch(() => undefined),
        ),
    );
  }

  async updateParticipantPermissions(
    roomName: string,
    identity: string,
    permissions: Partial<ParticipantPermission>,
  ): Promise<void> {
    const participant = await this.findParticipant(roomName, identity);
    if (!participant) {
      throw new BadRequestException('Participant is not in the room.');
    }

    const current = participant.permission;
    await this.rooms.updateParticipant(roomName, identity, {
      name: participant.name,
      metadata: participant.metadata,
      permission: {
        canSubscribe: true,
        canPublishData: true,
        hidden: false,
        recorder: false,
        ...current,
        ...permissions,
      },
    });
  }

  /** Add a single publish source (microphone/camera/screen_share) to a participant, keeping existing ones. */
  async grantPublishSource(roomName: string, identity: string, source: TrackSource): Promise<void> {
    const participant = await this.findParticipant(roomName, identity);
    if (!participant) throw new BadRequestException('Participant is not in the room.');

    // Server SDK exposes ParticipantInfo.permission (singular) — reading
    // `permissions` here silently returned undefined and every grant used to
    // REPLACE the previously granted sources instead of adding to them.
    const current = participant.permission;
    const sources = new Set<TrackSource>(current?.canPublishSources ?? []);
    sources.add(source);

    await this.rooms.updateParticipant(roomName, identity, {
      name: participant.name,
      metadata: participant.metadata,
      permission: {
        canSubscribe: true,
        canPublishData: true,
        hidden: false,
        recorder: false,
        ...current,
        canPublish: true,
        canPublishSources: Array.from(sources),
      },
    });
  }

  /** Remove a single publish source; when none remain, publishing is revoked entirely. */
  async revokePublishSource(roomName: string, identity: string, source: TrackSource): Promise<void> {
    const participant = await this.findParticipant(roomName, identity);
    if (!participant) throw new BadRequestException('Participant is not in the room.');

    const current = participant.permission;
    const remaining = (current?.canPublishSources ?? []).filter((s) => s !== source);

    await this.rooms.updateParticipant(roomName, identity, {
      name: participant.name,
      metadata: participant.metadata,
      permission: {
        canSubscribe: true,
        canPublishData: true,
        hidden: false,
        recorder: false,
        ...current,
        canPublish: remaining.length > 0,
        canPublishSources: remaining as TrackSource[],
      },
    });
  }

  async listParticipants(roomName: string): Promise<Array<{ identity: string; name?: string }>> {
    const participants = await this.rooms.listParticipants(roomName).catch(() => []);
    return participants.map((p) => ({ identity: p.identity, name: p.name }));
  }

  private async findParticipant(
    roomName: string,
    identity: string,
  ): Promise<{ identity: string; name?: string; tracks?: Array<{ sid: string; muted: boolean }>; permission?: ParticipantPermission & { canPublishSources?: TrackSource[] }; metadata?: string } | null> {
    try {
      return (await this.rooms.getParticipant(roomName, identity)) as any;
    } catch {
      return null;
    }
  }
}
