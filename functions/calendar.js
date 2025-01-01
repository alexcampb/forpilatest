const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// Configure OAuth2 credentials
const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    process.env.REDIRECT_URI
);

// Create Calendar API client
const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

/**
 * Error handler wrapper for calendar operations
 */
async function handleCalendarOperation(operation, ...args) {
    try {
        await loadSavedCredentials();
        return await operation(...args);
    } catch (error) {
        console.error(`Calendar operation failed:`, error);
        throw {
            operation: operation.name,
            error: error.message,
            details: error.errors || [],
            code: error.code
        };
    }
}

/**
 * Load saved credentials
 */
async function loadSavedCredentials() {
    try {
        const content = await fs.readFile('credentials.json');
        const credentials = JSON.parse(content);
        oauth2Client.setCredentials(credentials);
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Save credentials
 */
async function saveCredentials(tokens) {
    await fs.writeFile('credentials.json', JSON.stringify(tokens));
}

/**
 * Get OAuth2 URL for authentication
 */
function getAuthUrl() {
    const SCOPES = ['https://www.googleapis.com/auth/calendar'];
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
}

/**
 * Set credentials after OAuth2 callback
 */
async function setCredentials(code) {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    await saveCredentials(tokens);
}

// Core Calendar Operations
const calendarOperations = {
    async createCalendar(options) {
        const response = await calendar.calendars.insert({
            requestBody: {
                summary: options.summary,
                description: options.description,
                timeZone: options.timeZone || 'America/Los_Angeles'
            }
        });
        return response.data;
    },

    async deleteCalendar(calendarId) {
        await calendar.calendars.delete({ calendarId });
    },

    async listCalendars() {
        const response = await calendar.calendarList.list();
        return response.data.items.map(calendar => ({
            id: calendar.id,
            summary: calendar.summary,
            description: calendar.description,
            primary: calendar.primary || false,
            timeZone: calendar.timeZone,
            accessRole: calendar.accessRole
        }));
    },

    async shareCalendar(calendarId, options) {
        const response = await calendar.acl.insert({
            calendarId,
            requestBody: {
                role: options.role || 'reader',
                scope: {
                    type: 'user',
                    value: options.email
                }
            }
        });
        return response.data;
    },

    async addEvent(summary, startTime, endTime, options = {}) {
        const event = {
            summary,
            start: {
                dateTime: startTime,
                timeZone: options.timeZone || 'America/Los_Angeles',
            },
            end: {
                dateTime: endTime,
                timeZone: options.timeZone || 'America/Los_Angeles',
            },
            description: options.description,
            location: options.location,
            attendees: options.attendees,
            colorId: options.colorId,
            recurrence: options.recurrence ? [options.recurrence] : undefined,
            reminders: options.reminders ? {
                useDefault: false,
                overrides: options.reminders
            } : undefined,
            conferenceData: options.conferencing ? {
                createRequest: { requestId: Math.random().toString() }
            } : undefined,
            attachments: options.attachments
        };

        const response = await calendar.events.insert({
            calendarId: options.calendarId || 'primary',
            conferenceDataVersion: options.conferencing ? 1 : 0,
            requestBody: event
        });

        return response.data.htmlLink;
    },

    async searchEvents(options) {
        const response = await calendar.events.list({
            calendarId: options.calendarId || 'primary',
            timeMin: options.timeMin,
            timeMax: options.timeMax,
            q: options.query,
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: options.maxResults || 10
        });
        return response.data.items;
    },

    async updateEvent(eventId, updates, calendarId = 'primary') {
        const response = await calendar.events.patch({
            calendarId,
            eventId,
            requestBody: updates
        });
        return response.data;
    },

    async deleteEvent(eventId, calendarId = 'primary') {
        await calendar.events.delete({
            calendarId,
            eventId
        });
    },

    async respondToEvent(eventId, response, calendarId = 'primary', attendeeEmail) {
        const event = await calendar.events.get({
            calendarId,
            eventId
        });

        const attendees = event.data.attendees?.map(attendee => {
            if (attendee.email === attendeeEmail) {
                return { ...attendee, responseStatus: response };
            }
            return attendee;
        });

        return await this.updateEvent(eventId, { attendees }, calendarId);
    }
};

/**
 * Natural language calendar interface
 */
async function handleCalendarIntent(intent) {
    // Validate intent structure
    if (!intent || !intent.action) {
        throw new Error('Invalid intent: missing action');
    }

    // Handle different calendar actions
    switch (intent.action) {
        case 'findAvailableSlots':
            validateTimeConstraints(intent.constraints);
            
            // Get busy times for all participants
            const getBusyTimesFn = module.exports._internal?.getBusyTimes || getBusyTimes;
            const busyTimes = await getBusyTimesFn(
                intent.constraints.timeRange.earliest,
                intent.constraints.timeRange.latest,
                intent.constraints.participants || ['me']
            );

            // Find available slots
            const availableSlots = findAvailableTimeSlots(
                busyTimes,
                intent.constraints.timeRange.earliest,
                intent.constraints.timeRange.latest,
                intent.constraints.duration,
                intent.constraints.preferences
            );

            return {
                availableSlots,
                accessibleParticipants: ['me'],
                inaccessibleParticipants: []
            };

        case 'create_calendar':
            return handleCalendarOperation(
                calendarOperations.createCalendar,
                {
                    summary: intent.calendar.name,
                    description: intent.calendar.description,
                    timeZone: intent.calendar.timeZone || 'America/Los_Angeles'
                }
            );

        case 'share_calendar':
            return handleCalendarOperation(
                calendarOperations.shareCalendar,
                intent.calendar.id,
                {
                    email: intent.share.email,
                    role: intent.share.role || 'reader'
                }
            );

        case 'cleanup_calendars':
            return handleCalendarOperation(
                async () => {
                    const calendars = await handleCalendarOperation(calendarOperations.listCalendars);
                    const duplicates = calendars.filter(cal => 
                        cal.summary === intent.calendar.name &&
                        cal.accessRole === 'owner'
                    );

                    if (duplicates.length > 1) {
                        for (const cal of duplicates) {
                            await handleCalendarOperation(calendarOperations.deleteCalendar, cal.id);
                        }
                    }
                    return { deletedCount: duplicates.length };
                }
            );

        case 'schedule':
            return handleCalendarOperation(
                calendarOperations.addEvent,
                intent.event.title,
                intent.event.time.start,
                intent.event.time.end,
                {
                    description: intent.event.details?.description,
                    location: intent.event.details?.location,
                    attendees: intent.event.people?.map(email => ({ email })),
                    recurrence: translateRecurrence(intent.event.repeat),
                    conferencing: intent.event.details?.virtual,
                    reminders: intent.event.reminders ? {
                        useDefault: false,
                        overrides: intent.event.reminders
                    } : undefined,
                    colorId: intent.event.colorId,
                    calendarId: intent.event.calendarId || 'primary',
                    attachments: intent.event.attachments?.map(a => ({
                        fileUrl: a.url,
                        title: a.title,
                        mimeType: a.mimeType
                    }))
                }
            );

        case 'find_time':
            return handleCalendarOperation(
                async () => {
                    const calendars = await handleCalendarOperation(calendarOperations.listCalendars);
                    const accessibleEmails = new Set(
                        calendars.map(cal => cal.id)
                            .filter(id => id.includes('@'))
                    );
                    
                    const validParticipants = intent.constraints.participants
                        .filter(email => accessibleEmails.has(email));
                    
                    if (validParticipants.length === 0) {
                        throw new Error('No accessible calendars for any participants');
                    }

                    const busyTimes = await Promise.all(
                        validParticipants.map(async email => {
                            const events = await handleCalendarOperation(
                                calendarOperations.searchEvents,
                                {
                                    calendarId: email,
                                    timeMin: intent.constraints.timeRange.earliest,
                                    timeMax: intent.constraints.timeRange.latest
                                }
                            );
                            return events.map(e => ({
                                start: e.start.dateTime || e.start.date,
                                end: e.end.dateTime || e.end.date
                            }));
                        })
                    );

                    return {
                        slots: findAvailableTimeSlots(
                            busyTimes.flat(),
                            intent.constraints.timeRange.earliest,
                            intent.constraints.timeRange.latest,
                            intent.constraints.duration,
                            intent.constraints.preferences
                        ),
                        accessibleParticipants: validParticipants,
                        inaccessibleParticipants: intent.constraints.participants
                            .filter(email => !accessibleEmails.has(email))
                    };
                }
            );

        case 'list':
            return handleCalendarOperation(
                calendarOperations.searchEvents,
                {
                    query: intent.filter?.keyword || '',
                    timeMin: intent.timeRange?.start || new Date().toISOString(),
                    timeMax: intent.timeRange?.end || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                    calendarId: intent.calendar?.id || 'primary'
                }
            );

        case 'reschedule':
            return handleCalendarOperation(
                async () => {
                    const events = await handleCalendarOperation(
                        calendarOperations.searchEvents,
                        {
                            query: intent.event.title,
                            timeMin: intent.event.originalTime?.start,
                            timeMax: intent.event.originalTime?.end,
                            calendarId: intent.event.calendarId || 'primary'
                        }
                    );
                    
                    if (events.length === 0) {
                        throw new Error('Event not found in calendar');
                    }

                    return handleCalendarOperation(
                        calendarOperations.updateEvent,
                        events[0].id,
                        {
                            start: { dateTime: intent.event.newTime.start },
                            end: { dateTime: intent.event.newTime.end }
                        },
                        intent.event.calendarId || 'primary'
                    );
                }
            );

        case 'respond':
            return handleCalendarOperation(
                calendarOperations.respondToEvent,
                intent.response.eventId,
                intent.response.status,
                intent.response.calendarId || 'primary',
                intent.response.attendeeEmail
            );

        default:
            throw new Error(`Unknown action: ${intent.action}`);
    }
}

function validateTimeConstraints(constraints) {
    if (!constraints) {
        throw new Error('Invalid intent: missing constraints');
    }
    if (!constraints.timeRange || !constraints.timeRange.earliest || !constraints.timeRange.latest) {
        throw new Error('Invalid intent: missing timeRange');
    }
    if (!constraints.duration || typeof constraints.duration !== 'number') {
        throw new Error('Invalid intent: invalid duration');
    }
}

/**
 * Helper function to translate natural recurrence to RRULE
 */
function translateRecurrence(repeat) {
    if (!repeat) return null;
    
    const patterns = {
        'daily': 'RRULE:FREQ=DAILY',
        'weekly': 'RRULE:FREQ=WEEKLY',
        'monthly': 'RRULE:FREQ=MONTHLY',
        'weekdays': 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
        'biweekly': 'RRULE:FREQ=WEEKLY;INTERVAL=2',
        'yearly': 'RRULE:FREQ=YEARLY',
        'every_two_weeks': 'RRULE:FREQ=WEEKLY;INTERVAL=2',
        'every_two_months': 'RRULE:FREQ=MONTHLY;INTERVAL=2',
        'quarterly': 'RRULE:FREQ=MONTHLY;INTERVAL=3',
        'weekly_mon_wed_fri': 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
        'weekly_tue_thu': 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH'
    };

    if (typeof repeat === 'object') {
        if (repeat.frequency && repeat.days) {
            return `RRULE:FREQ=${repeat.frequency.toUpperCase()};BYDAY=${repeat.days.join(',')}`;
        }
        if (repeat.frequency && repeat.interval) {
            return `RRULE:FREQ=${repeat.frequency.toUpperCase()};INTERVAL=${repeat.interval}`;
        }
    }

    return patterns[repeat.toLowerCase()] || repeat;
}

/**
 * Find available time slots between busy times
 * @param {Array<{start: string, end: string}>} busyTimes Array of busy time slots
 * @param {string} earliest ISO string of earliest possible time
 * @param {string} latest ISO string of latest possible time
 * @param {number} duration Duration in minutes
 * @param {Object} preferences Time preferences
 * @returns {Array<{start: string, end: string, score: number}>} Available time slots with scores
 */
function findAvailableTimeSlots(busyTimes, earliest, latest, duration, preferences = {}) {
    // Convert times to Date objects for easier comparison
    const earliestDate = new Date(earliest);
    const latestDate = new Date(latest);
    const durationMs = duration * 60 * 1000;

    // Check if requested duration is longer than available window
    if (latestDate.getTime() - earliestDate.getTime() < durationMs) {
        return [];
    }

    // Sort and merge overlapping busy times
    const mergedBusy = mergeBusyTimes(busyTimes.map(slot => ({
        start: new Date(slot.start),
        end: new Date(slot.end)
    })));

    // Find gaps between busy times
    const availableSlots = findGaps(mergedBusy, earliestDate, latestDate, durationMs);

    // Score and filter slots
    return scoreAndFilterSlots(availableSlots, durationMs, preferences);
}

/**
 * Merge overlapping busy time slots
 * @param {Array<{start: Date, end: Date}>} busyTimes
 * @returns {Array<{start: Date, end: Date}>}
 */
function mergeBusyTimes(busyTimes) {
    if (busyTimes.length === 0) return [];

    // Sort by start time
    const sorted = busyTimes.sort((a, b) => a.start - b.start);
    const merged = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
        const current = sorted[i];
        const previous = merged[merged.length - 1];

        // If current slot overlaps with previous, merge them
        if (current.start <= previous.end) {
            previous.end = new Date(Math.max(previous.end, current.end));
        } else {
            merged.push(current);
        }
    }

    return merged;
}

/**
 * Find gaps between busy times that are long enough for the meeting
 * @param {Array<{start: Date, end: Date}>} mergedBusy
 * @param {Date} earliest
 * @param {Date} latest
 * @param {number} durationMs
 * @returns {Array<{start: Date, end: Date}>}
 */
function findGaps(mergedBusy, earliest, latest, durationMs) {
    const gaps = [];
    let currentStart = earliest;

    // Add gaps between busy times
    for (const busy of mergedBusy) {
        // If there's enough time before this busy slot, add it
        if (busy.start - currentStart >= durationMs) {
            gaps.push({
                start: currentStart,
                end: busy.start
            });
        }
        currentStart = busy.end;
    }

    // Add final gap if there's time after last busy slot
    if (latest - currentStart >= durationMs) {
        gaps.push({
            start: currentStart,
            end: latest
        });
    }

    return gaps;
}

/**
 * Score and filter available slots
 * @param {Array<{start: Date, end: Date}>} gaps
 * @param {number} durationMs
 * @param {Object} preferences
 * @returns {Array<{start: string, end: string, score: number}>}
 */

function scoreAndFilterSlots(gaps, durationMs, preferences) {
    const slots = [];

    // Default time preferences
    const defaultPreferences = {
        morning: { start: 9, end: 12, peak: 10, weight: 1, avgDuration: 60 },
        afternoon: { start: 12, end: 17, peak: 14, weight: 1, avgDuration: 45 },
        evening: { start: 17, end: 20, peak: 18, weight: 1, avgDuration: 30 }
    };

    // Merge user preferences with defaults
    const timePreferences = {
        morning: { ...defaultPreferences.morning, ...preferences.morning },
        afternoon: { ...defaultPreferences.afternoon, ...preferences.afternoon },
        evening: { ...defaultPreferences.evening, ...preferences.evening }
    };

    // Get preferred times array from preferences
    const preferredTimes = preferences.preferred || ['morning'];
    const maxResults = preferences.maxResults || 5;
    const increment = preferences.increment || 30; // minutes

    for (const gap of gaps) {
        let slotStart = gap.start;
        while (slotStart.getTime() + durationMs <= gap.end.getTime()) {
            const slotEnd = new Date(slotStart.getTime() + durationMs);
            const hour = slotStart.getHours();
            let score = 0;
            let maxWeight = 0;

            // Calculate score based on all preferred times
            for (const prefTime of preferredTimes) {
                const pref = timePreferences[prefTime];
                if (!pref) continue;

                maxWeight = Math.max(maxWeight, pref.weight);

                if (hour >= pref.start && hour < pref.end) {
                    // Base score for being in preferred time period
                    score = Math.max(score, 0.4 * pref.weight);

                    // Peak time bonus
                    const distanceFromPeak = Math.abs(hour - pref.peak);
                    const peakScore = Math.max(0, 0.4 - (distanceFromPeak * 0.1)) * pref.weight;
                    score = Math.max(score, score + peakScore);

                    // Duration match bonus
                    const durationMin = durationMs / (60 * 1000);
                    const avgDuration = pref.avgDuration || defaultPreferences[prefTime].avgDuration;
                    const durationFitScore = Math.max(0, 0.2 - Math.abs(durationMin - avgDuration) / avgDuration * 0.2);
                    score = Math.max(score, score + durationFitScore * pref.weight);
                }
            }

            // Normalize score based on maximum possible score with given weights
            score = score / (maxWeight * 1.0);

            slots.push({
                start: slotStart.toISOString(),
                end: slotEnd.toISOString(),
                score: Math.round(score * 100) / 100,
                metadata: {
                    timeOfDay: hour,
                    weightUsed: maxWeight
                }
            });

            // Move to next potential slot
            slotStart = new Date(slotStart.getTime() + increment * 60 * 1000);
        }
    }

    // Sort by score (highest first) and take top N
    return slots
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
}

async function getBusyTimes(earliest, latest, participants) {
    const busyTimes = [];

    for (const participant of participants) {
        const events = await calendar.events.list({
            calendarId: participant,
            timeMin: earliest,
            timeMax: latest,
            singleEvents: true,
            orderBy: 'startTime'
        });

        busyTimes.push(...events.data.items.map(event => ({
            start: event.start.dateTime || event.start.date,
            end: event.end.dateTime || event.end.date
        })));
    }

    return busyTimes;
}

module.exports = {
    handleCalendarIntent,
    findAvailableTimeSlots,
    getAuthUrl,
    setCredentials,
    _internal: {}  // For testing
};
