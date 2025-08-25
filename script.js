let appData = null;
let userDetails = {};
let lastQuery = { day: null, time: null, findNext: false, source: null };
let lastDisplayedStatus = { status: null, lectureSubject: null };
let lastClickedButton = null; // New variable to track button clicks for animation

// --- CONFIGURATION ---
const CHECKABLE_ROOM_IDS = ["201", "202", "205", "206", "213", "214"];
const ECS_TEACHER_IDS = ["KT", "NK", "RM", "AD", "JA", "ABS", "YP", "AJV"];

// --- DATA LOADING ---
async function loadData() {
    try {
        const [ttResponse, teachersResponse, roomsResponse] = await Promise.all([
            fetch('./timetable.json'), fetch('./teachers.json'), fetch('./rooms.json')
        ]);
        if (!ttResponse.ok || !teachersResponse.ok || !roomsResponse.ok) throw new Error('Data file not found.');
        appData = {
            timetable: await ttResponse.json(),
            teachers: await teachersResponse.json(),
            rooms: await roomsResponse.json()
        };
    } catch (error) {
        console.error("Failed to load data files:", error);
        alert("Error loading data. Please check console.");
    }
}

// --- UTILITY FUNCTIONS ---
const getTeacherName = (id) => appData.teachers.find(t => t.id === id)?.name || id || 'N/A';
const getRoomInfo = (ids) => ids ? ids.join(' or ') : 'N/A';
const parseTimeToMinutes = (timeStr) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
};
const formatMinutes = (totalMinutes) => {
    if (totalMinutes < 1) return "<1m";
    if (totalMinutes < 60) return `${totalMinutes}m`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
};

// NEW: Animation helper function
function triggerAnimation(element, button) {
    if (lastClickedButton === button) return; // Don't re-animate if the same button is clicked
    
    element.classList.remove('animate-in');
    // Force a reflow to restart the animation
    void element.offsetWidth; 
    element.classList.add('animate-in');

    lastClickedButton = button;
}


// --- CORE LOGIC ---
function getPersonalScheduleForDay(day) {
    if (!userDetails.division) return [];
    
    let schedule = appData.timetable.filter(lec => 
        lec.divisions.includes(userDetails.division) && lec.day === day
    );

    schedule = schedule.filter(lec => {
        if (!lec.type && (!lec.batches || lec.batches.length > 1)) return true;
        if (!lec.type && lec.batches && lec.batches.includes(userDetails.labBatch)) return true;
        if (lec.type === 'tutorial' && userDetails.tutorialBatch && lec.batches.includes(userDetails.tutorialBatch)) return true;
        if (lec.type === 'elective' || lec.type === 'minor') return true;
        return false;
    });
    
    return schedule.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

function findLectureStatus(day, time, findNext = false) {
    const personalScheduleToday = getPersonalScheduleForDay(day);
    if (personalScheduleToday.length === 0) return { status: 'NO_LECTURES_TODAY' };

    const personalStartTime = personalScheduleToday[0].startTime;
    const personalEndTime = personalScheduleToday[personalScheduleToday.length - 1].endTime;
    
    let lecturesToConsider;
    const nextUpcomingLecture = personalScheduleToday.find(l => time < l.startTime);

    if (findNext) {
        if (!nextUpcomingLecture) return { status: 'NO_MORE_LECTURES' };
        lecturesToConsider = personalScheduleToday.filter(l => l.startTime === nextUpcomingLecture.startTime);
    } else {
        if (time < personalStartTime) return { status: 'COLLEGE_CLOSED_EARLY', nextLec: personalScheduleToday[0] };
        if (time >= personalEndTime) return { status: 'COLLEGE_CLOSED_LATE' };
        lecturesToConsider = personalScheduleToday.filter(lec => time >= lec.startTime && time < lec.endTime);
    }

    if (lecturesToConsider.length === 0) {
        return { status: 'IN_BREAK', nextLec: nextUpcomingLecture };
    }

    const choiceLectureGroup = lecturesToConsider.filter(lec => ['elective', 'minor'].includes(lec.type));
    if (choiceLectureGroup.length > 0) {
        const choiceType = choiceLectureGroup[0].type;
        let groupId = choiceType === 'elective' ? `elective_${choiceLectureGroup[0].electiveGroup}` : `minor_${choiceLectureGroup[0].minorGroup}`;
        const userChoice = userDetails.choices ? userDetails.choices[groupId] : null;

        if (userChoice) {
            if (userChoice === 'NONE') return { status: 'CHOICE_MADE_NONE', groupId: groupId, nextLec: nextUpcomingLecture };
            const applicableLec = choiceLectureGroup.find(lec => lec.subject === userChoice || lec.customGroup === userChoice);
            if (applicableLec) {
                return { status: findNext ? 'FOUND_NEXT' : 'IN_LECTURE', lecture: applicableLec };
            }
        } else {
            return { status: 'CHOICE_REQUIRED', options: choiceLectureGroup };
        }
    }

    if (lecturesToConsider.length > 0) {
        return { status: findNext ? 'FOUND_NEXT' : 'IN_LECTURE', lecture: lecturesToConsider[0] };
    }

    return { status: 'IN_BREAK', nextLec: nextUpcomingLecture };
}

function findEmptyRooms(day, time, floor = null) {
    const definitelyOccupied = new Set();
    const potentialLectures = [];

    appData.timetable.forEach(lec => {
        if (lec.day === day && time >= lec.startTime && time < lec.endTime) {
            if (lec.roomId.length === 1) {
                definitelyOccupied.add(lec.roomId[0]);
            } else {
                potentialLectures.push(lec);
            }
        }
    });

    const potentialRooms = new Set(potentialLectures.flatMap(lec => lec.roomId));
    let checkableRooms = appData.rooms.filter(room => CHECKABLE_ROOM_IDS.includes(room.id));
    
    let availableRooms = checkableRooms.filter(room => 
        !definitelyOccupied.has(room.id) && !potentialRooms.has(room.id)
    );

    if (floor !== null && floor !== 'all') {
        availableRooms = availableRooms.filter(room => room.floor == floor);
        const filteredPotential = potentialLectures.filter(lec => 
            lec.roomId.some(id => {
                const roomData = appData.rooms.find(r => r.id === id);
                return roomData && roomData.floor == floor;
            })
        );
         return { availableRooms, potentialLectures: filteredPotential };
    }

    return { availableRooms, potentialLectures };
}

function findTeacherLocation(teacherId, day, time) {
    const teacher = appData.teachers.find(t => t.id === teacherId);
    if (!teacher) return { status: 'NOT_FOUND' };
    if (time < "08:00" || time > "17:00") return { status: 'OUTSIDE_HOURS', teacherName: teacher.name };
    const currentLecture = appData.timetable.find(lec => lec.teacherId === teacherId && lec.day === day && time >= lec.startTime && time < lec.endTime);
    if (currentLecture) return { status: 'IN_LECTURE', lecture: currentLecture, teacherName: teacher.name };
    else return { status: 'IN_CABIN', cabin: teacher.cabinRoomId, teacherName: teacher.name };
}

function findRoomStatus(roomId, day, time) {
    const lectureInRoom = appData.timetable.find(lec => lec.day === day && time >= lec.startTime && time < lec.endTime && lec.roomId.includes(roomId));
    if (!lectureInRoom) return { status: 'AVAILABLE' };
    
    if (lectureInRoom.roomId.length > 1) {
        return { status: 'POTENTIALLY_OCCUPIED', lecture: lectureInRoom };
    }
    
    return { status: 'OCCUPIED', lecture: lectureInRoom };
}

function getFullSchedule() {
    if (!userDetails.division) return null;

    const personalSchedule = [];
    const daysOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

    daysOrder.forEach(day => {
        const dailySchedule = getPersonalScheduleForDay(day);
        dailySchedule.forEach(lec => personalSchedule.push(lec));
    });

    const processedSchedule = [];
    const processedGroups = new Set();

    const lecturesByTimeSlot = personalSchedule.reduce((acc, lec) => {
        const key = `${lec.day}-${lec.startTime}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push(lec);
        return acc;
    }, {});

    for (const key in lecturesByTimeSlot) {
        processedGroups.clear();
        const slotLectures = lecturesByTimeSlot[key];

        slotLectures.forEach(lec => {
            const isChoice = ['elective', 'minor'].includes(lec.type);
            const isLab = lec.batches && lec.batches.length === 1 && lec.type !== 'tutorial';
            const isTheoryOrTut = !lec.type || lec.type === 'tutorial';

            if (isChoice) {
                const choiceType = lec.type;
                let groupId = choiceType === 'elective' ? `elective_${lec.electiveGroup}` : `minor_${lec.minorGroup}`;
                
                if (processedGroups.has(groupId)) return;
                processedGroups.add(groupId);

                const userChoice = userDetails.choices ? userDetails.choices[groupId] : null;

                if (userChoice === 'NONE') {
                    processedSchedule.push({ ...lec, subject: `${choiceType.charAt(0).toUpperCase() + choiceType.slice(1)} Skipped`, isSkipped: true, groupId: groupId });
                } else if (userChoice) {
                    const applicableLec = slotLectures.find(l => {
                        const currentLecGroupId = l.type === 'elective' ? `elective_${l.electiveGroup}` : `minor_${l.minorGroup}`;
                        return currentLecGroupId === groupId && (l.subject === userChoice || l.customGroup === userChoice);
                    });
                    if (applicableLec) {
                        applicableLec.groupId = groupId;
                        processedSchedule.push(applicableLec);
                    }
                } else {
                    processedSchedule.push({ ...lec, subject: `${choiceType.charAt(0).toUpperCase() + choiceType.slice(1)} Choice Required`, isPlaceholder: true, groupId: groupId });
                }
            } else if (isLab) {
                const labGroupId = `${lec.startTime}-lab`;
                if (processedGroups.has(labGroupId)) return;
                processedGroups.add(labGroupId);

                const divisionLabs = appData.timetable.filter(l => l.day === lec.day && l.startTime === lec.startTime && l.divisions.includes(lec.divisions[0]) && l.batches && l.batches.length === 1);
                const myLab = divisionLabs.find(lab => lab.batches.includes(userDetails.labBatch));
                const otherLabs = divisionLabs.filter(lab => !lab.batches.includes(userDetails.labBatch));
                if (myLab) {
                    myLab.otherLabs = otherLabs;
                    processedSchedule.push(myLab);
                }
            } else if (isTheoryOrTut) {
                 if (!processedGroups.has(lec.subject)) {
                    processedSchedule.push(lec);
                    processedGroups.add(lec.subject);
                }
            }
        });
    }
    
    const scheduleByDay = processedSchedule.reduce((acc, lec) => {
        if (!acc[lec.day]) acc[lec.day] = [];
        acc[lec.day].push(lec);
        return acc;
    }, {});

    const scheduleWithBreaks = {};

    for (const day of daysOrder) {
        const lectures = scheduleByDay[day];
        if (!lectures || lectures.length === 0) continue;

        lectures.sort((a, b) => a.startTime.localeCompare(b.startTime));
        
        const dayWithBreaks = [];
        let lastEndTime = null;

        for (const lec of lectures) {
            if (lastEndTime && lastEndTime < lec.startTime) {
                 dayWithBreaks.push({
                    day: lec.day,
                    startTime: lastEndTime,
                    endTime: lec.startTime,
                    subject: 'Break',
                    isBreak: true
                });
            }
            dayWithBreaks.push(lec);
            lastEndTime = lec.endTime;
        }
        scheduleWithBreaks[day] = dayWithBreaks;
    }

    return scheduleWithBreaks;
}

// --- UI RENDERING ---
function renderScheduleResult(result) {
    const resultText = document.getElementById('schedule-result-text');
    const choiceModal = document.getElementById('choice-modal');
    choiceModal.classList.add('hidden');
    let html = '';

    lastDisplayedStatus = {
        status: result.status,
        lectureSubject: result.lecture ? result.lecture.subject : (result.nextLec ? result.nextLec.subject : null)
    };

    const createChangeButton = (lecture) => {
        if (!['elective', 'minor'].includes(lecture.type)) return '';
        let groupId = lecture.type === 'elective' ? `elective_${lecture.electiveGroup}` : `minor_${lecture.minorGroup}`;
        return `<button class="text-xs text-red-500 hover:underline ml-2" data-groupid="${groupId}">(Change Choice)</button>`;
    };
    
    switch (result.status) {
        case 'OUTSIDE_HOURS':
            html = `<p class="text-lg font-semibold">College is likely closed at this time.</p>`;
            break;
        case 'CHOICE_REQUIRED':
            renderChoiceModal(result.options);
            return;
        case 'CHOICE_MADE_NONE': {
            const changeButtonHtml = `<button class="text-xs text-red-500 hover:underline ml-2" data-groupid="${result.groupId}">(Change Choice)</button>`;
            html = `<div class="text-center"><p class="text-2xl font-bold text-green-600">You have a break!</p><p class="text-sm text-gray-600 mt-1">Choice saved as 'None'. ${changeButtonHtml}</p>${result.nextLec ? `<p class="text-lg text-gray-600 mt-1">Next lecture is at ${result.nextLec.startTime}.</p>` : ''}</div>`;
            break;
        }
        case 'IN_LECTURE': {
            const lec = result.lecture;
            const changeButtonHtml = createChangeButton(lec);
            html = `<div class="text-center"><div class="flex items-center justify-center"><p class="text-lg font-medium">You are in:</p>${changeButtonHtml}</div><h3 class="text-3xl font-bold text-blue-600 my-1">${lec.subject}</h3><p class="text-lg text-gray-700">with ${getTeacherName(lec.teacherId)}</p><p class="text-lg text-gray-700">in Room: <span class="font-semibold">${getRoomInfo(lec.roomId)}</span></p><p class="text-sm text-gray-500 mt-1">Ends at ${lec.endTime}</p></div>`;
            break;
        }
        case 'FOUND_NEXT': {
            const lec = result.lecture;
            const changeButtonHtml = createChangeButton(lec);
            html = `<div class="text-center"><div class="flex items-center justify-center"><p class="text-lg font-medium">Next lecture is:</p>${changeButtonHtml}</div><h3 class="text-3xl font-bold text-green-600 my-1">${lec.subject}</h3><p class="text-lg text-gray-700">at <span class="font-semibold">${lec.startTime}</span> in Room <span class="font-semibold">${getRoomInfo(lec.roomId)}</span></p></div>`;
            break;
        }
        case 'IN_BREAK':
            html = `<div class="text-center"><p class="text-2xl font-bold text-green-600">You have a break!</p>${result.nextLec ? `<p class="text-lg text-gray-600 mt-1">Next lecture is at ${result.nextLec.startTime}.</p>` : ''}</div>`;
            break;
        case 'COLLEGE_CLOSED_EARLY':
            html = `<p class="text-lg font-semibold">Your first lecture isn't until ${result.nextLec.startTime}.</p>`;
            break;
        case 'COLLEGE_CLOSED_LATE':
            html = `<p class="text-lg font-semibold">Your lectures for the day are over!</p>`;
            break;
        case 'NO_MORE_LECTURES':
             html = `<p class="text-lg font-semibold">No more lectures for you today!</p>`;
             break;
        default:
            html = `<p class="text-lg font-semibold">No lectures scheduled for you at this time.</p>`;
    }
    resultText.innerHTML = html;
}

function renderRoomResult(result, target) {
    const roomResultText = document.getElementById(target);
    let html = '';
    
    if (result.status === 'OUTSIDE_HOURS') {
        html = `<p class="text-lg font-semibold">College is likely closed at this time.</p>`;
    } else if (result.status === 'AVAILABLE') {
        html = `<p>Room is <strong class="text-green-600">Available</strong> at this time.</p>`;
    } else if (result.status === 'OCCUPIED') {
        html = `<p>Room is <strong class="text-red-600">Occupied</strong> by <strong>${result.lecture.divisions.join(', ')}</strong> for <strong>${result.lecture.subject}</strong>.</p>`;
    } else if (result.status === 'POTENTIALLY_OCCUPIED') {
        const otherRooms = result.lecture.roomId.join(', ');
        html = `<p>Room is <strong class="text-yellow-600">Potentially Occupied</strong>.</p><p class="text-sm text-gray-600">It's an option for the <strong>${result.lecture.subject}</strong> lecture (${result.lecture.divisions.join(', ')}), which could be in rooms: ${otherRooms}.</p>`;
    } else if (result.status === 'EMPTY_ROOMS') {
        const { availableRooms, potentialLectures } = result;
        if (availableRooms.length === 0 && potentialLectures.length === 0) {
            html = '<p>No empty or potentially empty rooms found at this time.</p>';
        } else {
            html = '<div class="text-left w-full space-y-3">';
            if (availableRooms.length > 0) {
                 const classrooms = availableRooms.filter(r => r.type === 'Classroom').map(r => r.id).join(', ');
                 const labs = availableRooms.filter(r => r.type === 'Lab').map(r => r.id).join(', ');
                 html += '<div>';
                 html += `<strong class="block text-green-700">Definitely Available:</strong>`;
                 if(classrooms) html += `<p class="text-sm">Classrooms: ${classrooms}</p>`;
                 if(labs) html += `<p class="text-sm">Labs: ${labs}</p>`;
                 html += '</div>';
            }
            if (potentialLectures.length > 0) {
                html += '<div>';
                html += `<strong class="block text-yellow-700">Potentially Available:</strong>`;
                potentialLectures.forEach(lec => {
                    html += `<p class="text-sm">One of these is free (<strong>${lec.subject}</strong> is in another): ${lec.roomId.join(', ')}</p>`;
                });
                html += '</div>';
            }
            html += '</div>';
        }
    }
    roomResultText.innerHTML = html;
}

function renderTeacherResult(location) {
    const teacherResultText = document.getElementById('teacher-result-text');
    let html = '';
    if (location.status === 'IN_LECTURE') html = `<p><strong class="font-semibold">${location.teacherName}</strong> is teaching <strong>${location.lecture.subject}</strong> to ${location.lecture.divisions.join(', ')} in Room: <strong>${getRoomInfo(location.lecture.roomId)}</strong>.</p>`;
    else if (location.status === 'IN_CABIN') html = `<p><strong class="font-semibold">${location.teacherName}</strong> is likely in their cabin: <strong>${location.cabin || 'N/A'}</strong>.</p>`;
    else if (location.status === 'OUTSIDE_HOURS') html = `<p><strong class="font-semibold">${location.teacherName}</strong> is likely not in college at this time.</p>`;
    else html = `<p>Please select a teacher to find their location.</p>`;
    teacherResultText.innerHTML = html;
}

function renderChoiceModal(options) {
    const modal = document.getElementById('choice-modal');
    const title = document.getElementById('choice-title');
    const optionsContainer = document.getElementById('choice-options');
    const type = options[0].type;
    
    let groupId;
    if (type === 'elective') groupId = `elective_${options[0].electiveGroup}`;
    else if (type === 'minor') groupId = `minor_${options[0].minorGroup}`;

    title.textContent = `Please select your ${type}:`;
    optionsContainer.innerHTML = '';
    
    const uniqueOptions = [...new Map(options.map(item => [item.customGroup || item.subject, item])).values()];
    uniqueOptions.forEach(option => {
        const button = document.createElement('button');
        button.className = 'w-full text-left p-3 bg-gray-100 hover:bg-blue-100 rounded-md';
        const buttonText = option.customGroup ? `${option.subject} (${option.customGroup})` : option.subject;
        const choiceValue = option.customGroup || option.subject;
        button.textContent = buttonText;
        button.onclick = () => handleChoiceSelection(groupId, choiceValue);
        optionsContainer.appendChild(button);
    });
    if (type === 'minor') {
        const noMinorButton = document.createElement('button');
        noMinorButton.className = 'w-full text-left p-3 bg-gray-100 hover:bg-red-100 rounded-md mt-2';
        noMinorButton.textContent = 'I did not take a Minor';
        noMinorButton.onclick = () => handleChoiceSelection(groupId, 'NONE');
        optionsContainer.appendChild(noMinorButton);
    }
    
    modal.classList.remove('hidden');
}

function renderFullSchedule(scheduleByDay) {
    const resultText = document.getElementById('schedule-result-text');
    if (!scheduleByDay || Object.keys(scheduleByDay).length === 0) {
        resultText.innerHTML = `<p class="text-lg font-semibold">No schedule found for your division.</p>`;
        return;
    }

    const daysOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    let html = '<div class="text-left w-full space-y-4">';

    for (const day of daysOrder) {
        const lectures = scheduleByDay[day];
        if (lectures && lectures.length > 0) {
            html += `<div><h3 class="text-lg font-bold text-blue-600 border-b-2 border-blue-200 mb-2">${day}</h3>`;
            html += '<ul class="space-y-2">';
            lectures.forEach(lec => {
                const timeslotAttr = `data-timeslot="${lec.day}-${lec.startTime}"`;
                if (lec.isBreak) {
                    html += `<li class="p-2 rounded-md text-center bg-gray-100 text-gray-500" ${timeslotAttr}>`;
                    html += `<p class="font-semibold text-sm">${lec.startTime} - ${lec.endTime}: Break</p>`;
                } else if (lec.isPlaceholder) {
                    html += `<li class="p-2 rounded-md bg-yellow-100 text-yellow-800" ${timeslotAttr}>`;
                    html += `<p class="font-semibold">${lec.startTime} - ${lec.endTime}: <span class="text-red-600">${lec.subject}</span></p>`;
                    html += `<button class="text-sm bg-blue-500 text-white py-1 px-3 rounded-md mt-1 hover:bg-blue-600" data-choose-groupid="${lec.groupId}">Choose</button>`;
                } else if (lec.isSkipped) {
                    html += `<li class="p-2 rounded-md bg-gray-200 text-gray-500" ${timeslotAttr}>`;
                    html += `<div class="flex justify-between items-center">`;
                    html += `<p class="font-semibold">${lec.startTime} - ${lec.endTime}: ${lec.subject}</p>`;
                    html += `<button class="text-xs text-red-500 hover:underline" data-groupid="${lec.groupId}">(Change)</button>`;
                    html += `</div>`;
                }
                else {
                    html += `<li class="p-2 rounded-md bg-gray-50" ${timeslotAttr}>`;
                    html += `<div class="flex justify-between items-center">`;
                    html += `<p class="font-semibold">${lec.startTime} - ${lec.endTime}: ${lec.subject}</p>`;
                    if (['elective', 'minor'].includes(lec.type)) {
                        html += `<button class="text-xs text-red-500 hover:underline" data-groupid="${lec.groupId}">(Change)</button>`;
                    }
                    html += `</div>`;
                    html += `<p class="text-sm text-gray-600 ml-2"> → ${getTeacherName(lec.teacherId)} in ${getRoomInfo(lec.roomId)}</p>`;
                    if (lec.otherLabs && lec.otherLabs.length > 0) {
                        html += `<div class="mt-1 ml-2 text-xs text-gray-400 border-l-2 pl-2">`;
                        lec.otherLabs.forEach(otherLab => {
                            html += `<p>Batch ${otherLab.batches.join(', ')}: ${otherLab.subject} in ${getRoomInfo(otherLab.roomId)}</p>`;
                        });
                        html += `</div>`;
                    }
                }
                html += `</li>`;
            });
            html += '</ul></div>';
        }
    }
    html += '</div>';
    resultText.innerHTML = html;
}

function handleChoiceSelection(groupId, choiceValue) {
    userDetails.choices = userDetails.choices || {};
    userDetails.choices[groupId] = choiceValue;
    localStorage.setItem('userDetails', JSON.stringify(userDetails));
    document.getElementById('choice-modal').classList.add('hidden');
    if (lastQuery.source === 'current') document.getElementById('current-lec-btn').click();
    else if (lastQuery.source === 'next') document.getElementById('next-lec-btn').click();
    else if (lastQuery.source === 'full-week') document.getElementById('full-week-btn').click();
}

// --- REAL-TIME UI UPDATE ---
function updateRealTimeUI() {
    if (!appData || !userDetails.division) return;

    const progressSection = document.getElementById('realtime-progress-section');
    const progressTitle = document.getElementById('progress-title');
    const progressBarFill = document.getElementById('progress-bar-fill');
    const progressBarText = document.getElementById('progress-bar-text');

    const now = new Date();
    const currentDay = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getDay()];
    const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const currentTimeInMinutes = now.getHours() * 60 + now.getMinutes();
    
    const result = findLectureStatus(currentDay, currentTimeStr);
    
    // Auto-update schedule tab if it's open and was showing the current status
    const scheduleTab = document.getElementById('schedule-tab');
    const isScheduleTabActive = !scheduleTab.classList.contains('hidden');
    const statusHasChanged = result.status !== lastDisplayedStatus.status || (result.lecture && result.lecture.subject !== lastDisplayedStatus.lectureSubject);

    if (isScheduleTabActive && lastQuery.source === 'current' && statusHasChanged) {
        renderScheduleResult(result);
        triggerAnimation(document.getElementById('schedule-result-area'), 'auto-update'); // Animate the auto-update
    }
    
    // Highlighter Logic
    const currentlyHighlighted = document.querySelector('.current-lec-highlight');
    if (currentlyHighlighted) currentlyHighlighted.classList.remove('current-lec-highlight');
    let currentTimeslot = null;

    if (result.status === 'IN_LECTURE') {
        const currentLec = result.lecture;
        if (currentLec) {
            currentTimeslot = `[data-timeslot="${currentDay}-${currentLec.startTime}"]`;
        }
    } else if (result.status === 'IN_BREAK' || result.status === 'CHOICE_MADE_NONE') {
        const scheduleToday = getPersonalScheduleForDay(currentDay);
        const nextLec = result.nextLec;
        if (nextLec) {
            const nextLecIndex = scheduleToday.findIndex(lec => lec.startTime === nextLec.startTime);
            const prevLec = scheduleToday[nextLecIndex - 1];
            if (prevLec) {
                currentTimeslot = `[data-timeslot="${currentDay}-${prevLec.endTime}"]`;
            }
        }
    }
    
    if (currentTimeslot) {
        const elementToHighlight = document.querySelector(currentTimeslot);
        if (elementToHighlight) elementToHighlight.classList.add('current-lec-highlight');
    }

    // Progress Bar Logic (Lecture)
    if (result.status === 'IN_LECTURE') {
        const currentLec = result.lecture;
        const startTime = parseTimeToMinutes(currentLec.startTime);
        const endTime = parseTimeToMinutes(currentLec.endTime);
        const duration = endTime - startTime;
        const elapsed = currentTimeInMinutes - startTime;
        const percentage = Math.max(0, Math.min(100, (elapsed / duration) * 100));
        const remaining = Math.max(0, endTime - currentTimeInMinutes);

        progressSection.classList.remove('hidden');
        progressTitle.textContent = `Current Lecture: ${currentLec.subject}`;
        progressBarFill.style.width = `${percentage}%`;
        progressBarFill.classList.remove('bg-green-500');
        progressBarFill.classList.add('bg-blue-500');
        progressBarText.textContent = `${formatMinutes(remaining)} left`;
        return;
    }
    
    // Progress Bar Logic (Break)
    if (result.status === 'IN_BREAK' || result.status === 'CHOICE_MADE_NONE') {
        const scheduleToday = getPersonalScheduleForDay(currentDay);
        const nextLec = result.nextLec;
        if (!nextLec) { progressSection.classList.add('hidden'); return; }

        const nextLecIndex = scheduleToday.findIndex(lec => lec.startTime === nextLec.startTime);
        const prevLec = scheduleToday[nextLecIndex - 1];
        if (!prevLec) { progressSection.classList.add('hidden'); return; }

        const breakStartTime = parseTimeToMinutes(prevLec.endTime);
        const breakEndTime = parseTimeToMinutes(nextLec.startTime);

        const duration = breakEndTime - breakStartTime;
        if (duration <= 0) { progressSection.classList.add('hidden'); return; }
        const elapsed = currentTimeInMinutes - breakStartTime;
        const percentage = Math.max(0, Math.min(100, (elapsed / duration) * 100));
        const remaining = Math.max(0, breakEndTime - currentTimeInMinutes);
        
        progressSection.classList.remove('hidden');
        progressTitle.textContent = `Break Time`;
        progressBarFill.style.width = `${percentage}%`;
        progressBarFill.classList.remove('bg-blue-500');
        progressBarFill.classList.add('bg-green-500');
        progressBarText.textContent = `${formatMinutes(remaining)} left`;
        return;
    }
    
    // Hide progress bar if not in lecture or break
    progressSection.classList.add('hidden');
}


// --- INITIALIZATION ---
function initializeApp() {
    let realtimeClockInterval = null; 

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(registration => console.log('Service Worker registered successfully:', registration))
                .catch(error => console.log('Service Worker registration failed:', error));
        });
    }

    // Element References
    const setupSection = document.getElementById('setup-section');
    const mainApp = document.getElementById('main-app');
    const divisionSelect = document.getElementById('division-select');
    const labBatchSelect = document.getElementById('lab-batch-select');
    const tutorialBatchContainer = document.getElementById('tutorial-batch-container');
    const tutorialBatchSelect = document.getElementById('tutorial-batch-select');
    const saveDetailsBtn = document.getElementById('save-details-btn');
    const userDetailsDisplay = document.getElementById('user-details-display');
    const changeDetailsBtn = document.getElementById('change-details-btn');
    const currentLecBtn = document.getElementById('current-lec-btn');
    const nextLecBtn = document.getElementById('next-lec-btn');
    const fullWeekBtn = document.getElementById('full-week-btn');
    const findEmptyRoomsBtn = document.getElementById('find-empty-rooms-btn');
    const floorSelect = document.getElementById('floor-select');
    const teacherSelect = document.getElementById('teacher-select');
    const findTeacherBtn = document.getElementById('find-teacher-btn');
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const daySelect = document.getElementById('day-select');
    const timeInput = document.getElementById('time-input');
    const modeRealtime = document.getElementById('mode-realtime');
    const modeManual = document.getElementById('mode-manual');
    const scheduleResultArea = document.getElementById('schedule-result-area');
    const roomResultArea = document.getElementById('room-result-area');
    const teacherResultArea = document.getElementById('teacher-result-area');
    const roomSelect = document.getElementById('room-select');
    const findRoomStatusBtn = document.getElementById('find-room-status-btn');
    const resetAppBtn = document.getElementById('reset-app-btn');
    const resetConfirmModal = document.getElementById('reset-confirm-modal');
    const confirmResetBtn = document.getElementById('confirm-reset-btn');
    const cancelResetBtn = document.getElementById('cancel-reset-btn');
    
    const showMainApp = () => { setupSection.classList.add('hidden'); mainApp.classList.remove('hidden'); };
    const showSetup = () => { mainApp.classList.add('hidden'); setupSection.classList.remove('hidden'); };
    
    const updateTutorialBatchSelector = (division) => {
        const tutorialLectures = appData.timetable.filter(lec => lec.divisions.includes(division) && lec.type === 'tutorial');
        if (tutorialLectures.length > 0) {
            const tutorialBatches = [...new Set(tutorialLectures.flatMap(lec => lec.batches))];
            tutorialBatchSelect.innerHTML = '';
            tutorialBatches.sort().forEach(batch => {
                const option = document.createElement('option');
                option.value = batch;
                option.textContent = batch;
                tutorialBatchSelect.appendChild(option);
            });
            tutorialBatchContainer.classList.remove('hidden');
        } else {
            tutorialBatchContainer.classList.add('hidden');
        }
    };

    const saveUserDetails = () => {
        const division = divisionSelect.value;
        if (!division) { alert('Please select your division.'); return; }

        const newUserDetails = {
            division: division,
            labBatch: labBatchSelect.value,
            tutorialBatch: tutorialBatchContainer.classList.contains('hidden') ? null : tutorialBatchSelect.value,
            choices: {}
        };

        if (userDetails.division === division) {
            newUserDetails.choices = userDetails.choices;
        }

        userDetails = newUserDetails;
        localStorage.setItem('userDetails', JSON.stringify(userDetails));
        updateUserInfoDisplay();
        document.getElementById('schedule-result-text').innerHTML = 'Your schedule results will appear here.';
        showMainApp();
    };

    const updateUserInfoDisplay = () => {
        let display = `Div: ${userDetails.division} | Lab: ${userDetails.labBatch}`;
        if (userDetails.tutorialBatch) {
            display += ` | Tut: ${userDetails.tutorialBatch}`;
        }
        userDetailsDisplay.textContent = display;
    };
    
    const setTimeToNow = () => {
        const now = new Date();
        const dayOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getDay()];
        if (dayOfWeek !== 'Sunday') daySelect.value = dayOfWeek;
        timeInput.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    };

    const updateLookupModeUI = () => {
        clearInterval(realtimeClockInterval);
        const isManual = modeManual.checked;
        daySelect.disabled = !isManual;
        timeInput.disabled = !isManual;
        if (!isManual) {
            setTimeToNow();
            realtimeClockInterval = setInterval(setTimeToNow, 30000); // Update manual time less frequently
        }
    };
    
    const getLookupTime = () => {
        if (modeRealtime.checked) {
            const now = new Date();
            const day = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getDay()];
            const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            return { day, time };
        } else {
            return { day: daySelect.value, time: timeInput.value };
        }
    };

    divisionSelect.addEventListener('change', () => {
        updateTutorialBatchSelector(divisionSelect.value);
    });

    tabButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            if (button.classList.contains('active-tab')) return; // Don't re-animate active tab
            lastClickedButton = null; // Reset button tracking when switching tabs

            tabButtons.forEach(btn => btn.classList.remove('active-tab'));
            button.classList.add('active-tab');

            tabContents.forEach(content => content.classList.add('hidden'));
            const targetTab = document.getElementById(`${button.dataset.tab}-tab`);
            
            targetTab.classList.remove('hidden');
            targetTab.classList.remove('animate-in');
            void targetTab.offsetWidth;
            targetTab.classList.add('animate-in');
        });
    });

    saveDetailsBtn.addEventListener('click', saveUserDetails);
    changeDetailsBtn.addEventListener('click', showSetup);
    modeRealtime.addEventListener('change', updateLookupModeUI);
    modeManual.addEventListener('change', updateLookupModeUI);

    currentLecBtn.addEventListener('click', (e) => {
        const { day, time } = getLookupTime();
        lastQuery = { day, time, findNext: false, source: 'current' };
        const result = findLectureStatus(day, time, false);
        renderScheduleResult(result);
        triggerAnimation(scheduleResultArea, e.currentTarget);
    });

    nextLecBtn.addEventListener('click', (e) => {
        const { day, time } = getLookupTime();
        lastQuery = { day, time, findNext: true, source: 'next' };
        const result = findLectureStatus(day, time, true);
        renderScheduleResult(result);
        triggerAnimation(scheduleResultArea, e.currentTarget);
    });

    fullWeekBtn.addEventListener('click', (e) => {
        lastQuery = { source: 'full-week' };
        const schedule = getFullSchedule();
        renderFullSchedule(schedule);
        updateRealTimeUI(); // Immediately check for highlight
        triggerAnimation(scheduleResultArea, e.currentTarget);
    });

    findEmptyRoomsBtn.addEventListener('click', (e) => {
        const { day, time } = getLookupTime();
        const floor = floorSelect.value;
        const result = findEmptyRooms(day, time, floor);
        renderRoomResult({ status: 'EMPTY_ROOMS', ...result }, 'room-result-text');
        triggerAnimation(roomResultArea, e.currentTarget);
    });
    
    findRoomStatusBtn.addEventListener('click', (e) => {
        const { day, time } = getLookupTime();
        const roomId = roomSelect.value;
        if (!roomId) return;
        const status = findRoomStatus(roomId, day, time);
        renderRoomResult(status, 'room-result-text');
        triggerAnimation(roomResultArea, e.currentTarget);
    });

    findTeacherBtn.addEventListener('click', (e) => {
        const teacherId = teacherSelect.value;
        if (!teacherId) { renderTeacherResult({ status: 'NOT_FOUND' }); return; }
        const { day, time } = getLookupTime();
        const location = findTeacherLocation(teacherId, day, time);
        renderTeacherResult(location);
        triggerAnimation(teacherResultArea, e.currentTarget);
    });

    const openChoiceModalForGroup = (groupId) => {
        const options = appData.timetable.filter(lec => {
            const lecType = lec.type;
            if (!lecType) return false;
            let currentGroupId = lecType === 'elective' ? `elective_${lec.electiveGroup}` : `minor_${lec.minorGroup}`;
            return currentGroupId === groupId;
        });
        if (options.length > 0) {
            renderChoiceModal(options);
        }
    };

    scheduleResultArea.addEventListener('click', (event) => {
        const groupId = event.target.dataset.groupid || event.target.dataset.chooseGroupid;
        if (groupId) {
            openChoiceModalForGroup(groupId);
        }
    });

    resetAppBtn.addEventListener('click', () => {
        resetConfirmModal.classList.remove('hidden');
    });
    cancelResetBtn.addEventListener('click', () => {
        resetConfirmModal.classList.add('hidden');
    });
    confirmResetBtn.addEventListener('click', () => {
        localStorage.removeItem('userDetails');
        localStorage.removeItem('pwaToastDismissed');
        location.reload();
    });

    // Populate dropdowns
    const allDivisions = new Set(appData.timetable.flatMap(lec => lec.divisions));
    [...allDivisions].sort().forEach(division => {
        const option = document.createElement('option');
        option.value = division;
        option.textContent = division;
        divisionSelect.appendChild(option);
    });

    const checkableRoomsData = appData.rooms.filter(r => CHECKABLE_ROOM_IDS.includes(r.id));
    const allFloors = new Set(checkableRoomsData.map(room => room.floor));
    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'All Checkable Floors';
    floorSelect.appendChild(allOption);
    [...allFloors].sort((a, b) => a - b).forEach(floor => {
        const option = document.createElement('option');
        option.value = floor;
        option.textContent = `Floor ${floor}`;
        floorSelect.appendChild(option);
    });

    checkableRoomsData.sort((a,b) => a.id.localeCompare(b.id)).forEach(room => {
        const option = document.createElement('option');
        option.value = room.id;
        option.textContent = `Room ${room.id}`;
        roomSelect.appendChild(option);
    });

    appData.teachers.filter(t => ECS_TEACHER_IDS.includes(t.id)).sort((a, b) => a.name.localeCompare(b.name)).forEach(teacher => {
        const option = document.createElement('option');
        option.value = teacher.id;
        option.textContent = teacher.name;
        teacherSelect.appendChild(option);
    });
    
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    days.forEach(day => { const option = document.createElement('option'); option.value = day; option.textContent = day; daySelect.appendChild(option); });
    
    // Initial Load
    const savedDetails = localStorage.getItem('userDetails');
    if (savedDetails) {
        userDetails = JSON.parse(savedDetails);
        divisionSelect.value = userDetails.division;
        labBatchSelect.value = userDetails.labBatch;
        updateTutorialBatchSelector(userDetails.division);
        if(userDetails.tutorialBatch) {
            tutorialBatchSelect.value = userDetails.tutorialBatch;
        }
        updateUserInfoDisplay();
        showMainApp();
    } else {
        showSetup();
    }
    updateLookupModeUI();
    setInterval(updateRealTimeUI, 1000); // Master real-time clock

    const pwaToast = document.getElementById('pwa-toast');
    const pwaToastClose = document.getElementById('pwa-toast-close');

    // Show PWA toast on first visit
    if (!localStorage.getItem('pwaToastDismissed')) {
        setTimeout(() => {
            pwaToast.classList.add('show');
        }, 1000); // Show after 1 second
    }

    pwaToastClose.addEventListener('click', () => {
        pwaToast.classList.remove('show');
        localStorage.setItem('pwaToastDismissed', 'true');
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    if (appData) initializeApp();
});
