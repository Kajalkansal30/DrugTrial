import jsPDF from 'jspdf';
import 'jspdf-autotable';

export const generateTrialReport = async (trial, eligibilityResults, sections, apiClient) => {
    const doc = new jsPDF('p', 'mm', 'a4');
    let yPosition = 20;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - (2 * margin);

    // Helper function for page break
    const checkPageBreak = (neededSpace = 20) => {
        if (yPosition + neededSpace > pageHeight - margin) {
            doc.addPage();
            yPosition = 20;
            return true;
        }
        return false;
    };

    // Helper to add section header
    const addSectionHeader = (title) => {
        checkPageBreak(30);
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(25, 42, 86);
        doc.text(title, margin, yPosition);
        yPosition += 3;
        doc.setLineWidth(0.5);
        doc.setDrawColor(100, 116, 139);
        doc.line(margin, yPosition, pageWidth - margin, yPosition);
        yPosition += 10;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
    };

    // Header - Report Title
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text('Clinical Trial Comprehensive Report', pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 8;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 15;

    // ====================
    // 1. TRIAL INFORMATION
    // ====================
    if (sections.trialInfo && trial) {
        addSectionHeader('Trial Information');

        const trialInfo = [
            ['Trial ID', trial.trialId || 'N/A'],
            ['Protocol Title', trial.protocolTitle || 'N/A'],
            ['Phase', trial.phase || 'N/A'],
            ['Drug Name', trial.drugName || 'N/A'],
            ['Indication', trial.indication || 'N/A'],
            ['Status', trial.status || 'N/A'],
            ['Created Date', trial.createdAt ? new Date(trial.createdAt).toLocaleDateString() : 'N/A']
        ];

        doc.autoTable({
            startY: yPosition,
            head: [['Field', 'Value']],
            body: trialInfo,
            theme: 'striped',
            headStyles: { fillColor: [79, 70, 229], textColor: 255 },
            margin: { left: margin, right: margin },
            styles: { fontSize: 9 }
        });

        yPosition = doc.lastAutoTable.finalY + 15;
    }

    // ====================
    // 2. FDA FORMS
    // ====================
    if (sections.fdaForms) {
        try {
            const rulesRes = await apiClient.get(`/api/trials/${trial.trial_id || trial.trialId}/rules`);
            const fdaForms = rulesRes.data?.fda_forms || {};

            addSectionHeader('FDA Forms');

            // FDA 1571
            if (fdaForms.fda_1571) {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(12);
                doc.text('Form FDA 1571 - IND Application', margin, yPosition);
                yPosition += 8;
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);

                const fda1571Data = [
                    ['Sponsor Name', fdaForms.fda_1571.sponsor_name || 'N/A'],
                    ['Sponsor Address', fdaForms.fda_1571.sponsor_address || 'N/A'],
                    ['IND Number', fdaForms.fda_1571.ind_number || 'N/A'],
                    ['Drug Name', fdaForms.fda_1571.drug_name || 'N/A'],
                    ['Phase', fdaForms.fda_1571.phase || 'N/A']
                ];

                doc.autoTable({
                    startY: yPosition,
                    body: fda1571Data,
                    theme: 'plain',
                    margin: { left: margin + 5, right: margin },
                    styles: { fontSize: 9, cellPadding: 2 }
                });

                yPosition = doc.lastAutoTable.finalY + 10;
            }

            // FDA 1572
            checkPageBreak(40);
            if (fdaForms.fda_1572) {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(12);
                doc.text('Form FDA 1572 - Statement of Investigator', margin, yPosition);
                yPosition += 8;
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);

                const fda1572Data = [
                    ['Investigator Name', fdaForms.fda_1572.investigator_name || 'N/A'],
                    ['Institution', fdaForms.fda_1572.institution || 'N/A'],
                    ['Department', fdaForms.fda_1572.department || 'N/A'],
                    ['Address', fdaForms.fda_1572.address || 'N/A'],
                    ['Phone', fdaForms.fda_1572.phone || 'N/A']
                ];

                doc.autoTable({
                    startY: yPosition,
                    body: fda1572Data,
                    theme: 'plain',
                    margin: { left: margin + 5, right: margin },
                    styles: { fontSize: 9, cellPadding: 2 }
                });

                yPosition = doc.lastAutoTable.finalY + 15;
            }
        } catch (err) {
            console.error('Error fetching FDA forms:', err);
            doc.setTextColor(220, 38, 38);
            doc.text('FDA forms data unavailable', margin, yPosition);
            yPosition += 10;
            doc.setTextColor(0, 0, 0);
        }
    }

    // ====================
    // 3. ELIGIBILITY CRITERIA
    // ====================
    if (sections.eligibilityCriteria) {
        try {
            const rulesRes = await apiClient.get(`/api/trials/${trial.trial_id || trial.trialId}/rules`);
            const rules = rulesRes.data?.rules || [];

            checkPageBreak(40);
            addSectionHeader('Eligibility Criteria');

            const inclusionCriteria = rules.filter(r => r.type === 'inclusion');
            const exclusionCriteria = rules.filter(r => r.type === 'exclusion');

            // Inclusion Criteria
            if (inclusionCriteria.length > 0) {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(11);
                doc.setTextColor(6, 95, 70);
                doc.text(`Inclusion Criteria (${inclusionCriteria.length})`, margin, yPosition);
                yPosition += 8;
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                doc.setTextColor(0, 0, 0);

                inclusionCriteria.forEach((criterion, index) => {
                    checkPageBreak(15);
                    const text = `${index + 1}. ${criterion.text || criterion.criterion_text || 'N/A'}`;
                    const lines = doc.splitTextToSize(text, contentWidth - 5);
                    doc.text(lines, margin + 3, yPosition);
                    yPosition += (lines.length * 5) + 3;
                });

                yPosition += 10;
            }

            // Exclusion Criteria
            checkPageBreak(40);
            if (exclusionCriteria.length > 0) {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(11);
                doc.setTextColor(190, 18, 60);
                doc.text(`Exclusion Criteria (${exclusionCriteria.length})`, margin, yPosition);
                yPosition += 8;
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(9);
                doc.setTextColor(0, 0, 0);

                exclusionCriteria.forEach((criterion, index) => {
                    checkPageBreak(15);
                    const text = `${index + 1}. ${criterion.text || criterion.criterion_text || 'N/A'}`;
                    const lines = doc.splitTextToSize(text, contentWidth - 5);
                    doc.text(lines, margin + 3, yPosition);
                    yPosition += (lines.length * 5) + 3;
                });

                yPosition += 15;
            }
        } catch (err) {
            console.error('Error fetching criteria:', err);
            doc.setTextColor(220, 38, 38);
            doc.text('Eligibility criteria data unavailable', margin, yPosition);
            yPosition += 10;
            doc.setTextColor(0, 0, 0);
        }
    }

    // ====================
    // 4. PATIENT ANALYSIS
    // ====================
    if (sections.patientAnalysis && eligibilityResults && eligibilityResults.length > 0) {
        checkPageBreak(40);
        addSectionHeader('Patient Screening Analysis');

        const eligible = eligibilityResults.filter(e =>
            e.status === 'ELIGIBLE' || e.eligibility_status?.includes('ELIGIBLE')
        ).length;
        const ineligible = eligibilityResults.filter(e =>
            e.status === 'INELIGIBLE' || e.eligibility_status === 'INELIGIBLE'
        ).length;
        const uncertain = eligibilityResults.length - eligible - ineligible;

        // Summary stats
        const summaryData = [
            ['Total Patients Screened', eligibilityResults.length.toString()],
            ['Eligible Patients', eligible.toString()],
            ['Ineligible Patients', ineligible.toString()],
            ['Uncertain / Needs Review', uncertain.toString()],
            ['Eligibility Rate', `${((eligible / eligibilityResults.length) * 100).toFixed(1)}%`]
        ];

        doc.autoTable({
            startY: yPosition,
            body: summaryData,
            theme: 'grid',
            headStyles: { fillColor: [79, 70, 229] },
            margin: { left: margin, right: margin },
            styles: { fontSize: 9, cellPadding: 3 }
        });

        yPosition = doc.lastAutoTable.finalY + 15;

        // Patient details table
        checkPageBreak(40);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('Individual Patient Results', margin, yPosition);
        yPosition += 8;

        const patientTableData = eligibilityResults.slice(0, 50).map(result => [
            result.patient_id || result.patientId || 'N/A',
            result.status || result.eligibility_status || 'N/A',
            result.confidence ? `${(result.confidence * 100).toFixed(0)}%` :
                result.confidence_score ? `${(result.confidence_score * 100).toFixed(0)}%` : 'N/A',
            `${result.criteria_met || 0}/${result.criteria_total || 0}`
        ]);

        doc.autoTable({
            startY: yPosition,
            head: [['Patient ID', 'Status', 'Confidence', 'Criteria Met']],
            body: patientTableData,
            theme: 'striped',
            headStyles: { fillColor: [79, 70, 229], textColor: 255 },
            margin: { left: margin, right: margin },
            styles: { fontSize: 8, cellPadding: 2 },
            columnStyles: {
                0: { cellWidth: 45 },
                1: { cellWidth: 45 },
                2: { cellWidth: 25 },
                3: { cellWidth: 25 }
            }
        });

        yPosition = doc.lastAutoTable.finalY + 15;

        if (eligibilityResults.length > 50) {
            doc.setFontSize(8);
            doc.setTextColor(100, 116, 139);
            doc.text(`Showing first 50 of ${eligibilityResults.length} patients`, margin, yPosition);
            yPosition += 10;
            doc.setTextColor(0, 0, 0);
        }
    }

    // ====================
    // 5. IN-SILICO DATA
    // ====================
    if (sections.inSilicoData) {
        try {
            const trialId = trial.trialId || trial.trial_id;
            const inSilicoRes = await apiClient.get(`/api/insilico/results/${trialId}`);
            const inSilicoData = inSilicoRes.data;

            checkPageBreak(40);
            addSectionHeader('In-Silico Research Data');

            if (inSilicoData && Object.keys(inSilicoData).length > 0) {
                // Drug properties
                if (inSilicoData.drugProperties) {
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(11);
                    doc.text('Drug Properties & Molecular Analysis', margin, yPosition);
                    yPosition += 8;

                    const drugData = [
                        ['Molecular Formula', inSilicoData.drugProperties.formula || 'N/A'],
                        ['Molecular Weight', inSilicoData.drugProperties.molecularWeight || 'N/A'],
                        ['LogP', inSilicoData.drugProperties.logP || 'N/A'],
                        ['TPSA', inSilicoData.drugProperties.tpsa || 'N/A'],
                        ['H-Bond Donors', inSilicoData.drugProperties.hDonors || 'N/A'],
                        ['H-Bond Acceptors', inSilicoData.drugProperties.hAcceptors || 'N/A']
                    ];

                    doc.autoTable({
                        startY: yPosition,
                        body: drugData,
                        theme: 'plain',
                        margin: { left: margin + 5, right: margin },
                        styles: { fontSize: 9, cellPadding: 2 }
                    });

                    yPosition = doc.lastAutoTable.finalY + 10;
                }

                // Toxicity predictions
                checkPageBreak(30);
                if (inSilicoData.toxicityPredictions) {
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(11);
                    doc.text('Toxicity Predictions', margin, yPosition);
                    yPosition += 8;

                    const toxData = Object.entries(inSilicoData.toxicityPredictions).map(([key, value]) => [
                        key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                        value.toString()
                    ]);

                    doc.autoTable({
                        startY: yPosition,
                        body: toxData,
                        theme: 'plain',
                        margin: { left: margin + 5, right: margin },
                        styles: { fontSize: 9, cellPadding: 2 }
                    });

                    yPosition = doc.lastAutoTable.finalY + 15;
                }
            } else {
                doc.setTextColor(100, 116, 139);
                doc.text('No in-silico data available for this trial', margin, yPosition);
                yPosition += 10;
                doc.setTextColor(0, 0, 0);
            }
        } catch (err) {
            console.error('Error fetching in-silico data:', err);
            doc.setTextColor(100, 116, 139);
            doc.text('In-silico data not available', margin, yPosition);
            yPosition += 10;
            doc.setTextColor(0, 0, 0);
        }
    }

    // ====================
    // 6. STATISTICAL SUMMARY
    // ====================
    if (sections.statisticalSummary && eligibilityResults && eligibilityResults.length > 0) {
        checkPageBreak(40);
        addSectionHeader('Statistical Summary & Analytics');

        const eligible = eligibilityResults.filter(e =>
            e.status === 'ELIGIBLE' || e.eligibility_status?.includes('ELIGIBLE')
        );
        const avgConfidence = eligible.reduce((acc, e) =>
            acc + (e.confidence || e.confidence_score || 0), 0
        ) / (eligible.length || 1);

        const statsData = [
            ['Average Confidence Score', `${(avgConfidence * 100).toFixed(1)}%`],
            ['Screening Success Rate', `${((eligible.length / eligibilityResults.length) * 100).toFixed(1)}%`],
            ['Total Criteria Evaluated', eligible.reduce((acc, e) => acc + (e.criteria_total || 0), 0).toString()],
            ['Average Criteria Met', `${(eligible.reduce((acc, e) => acc + (e.criteria_met || 0), 0) / (eligible.length || 1)).toFixed(1)}`]
        ];

        doc.autoTable({
            startY: yPosition,
            body: statsData,
            theme: 'grid',
            margin: { left: margin, right: margin },
            styles: { fontSize: 9, cellPadding: 3 }
        });

        yPosition = doc.lastAutoTable.finalY + 10;
    }

    // Footer on each page
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(
            `Page ${i} of ${totalPages} | Generated: ${new Date().toLocaleString()}`,
            pageWidth / 2,
            pageHeight - 10,
            { align: 'center' }
        );
    }

    return doc;
};

export const generateHTMLReport = async (trial, eligibilityResults, sections, apiClient) => {
    let html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Clinical Trial Report - ${trial.trialId || 'Trial'}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 900px;
            margin: 0 auto;
            padding: 40px 20px;
            color: #1e293b;
            line-height: 1.6;
        }
        .header {
            text-align: center;
            margin-bottom: 40px;
            border-bottom: 3px solid #4f46e5;
            padding-bottom: 20px;
        }
        h1 {
            color: #1e293b;
            font-size: 28px;
            margin: 0 0 10px 0;
        }
        .timestamp {
            color: #64748b;
            font-size: 14px;
        }
        .section {
            margin: 30px 0;
            page-break-inside: avoid;
        }
        .section-title {
            font-size: 20px;
            color: #1e293b;
            border-bottom: 2px solid #cbd5e1;
            padding-bottom: 8px;
            margin-bottom: 15px;
            font-weight: bold;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 15px 0;
        }
        th, td {
            padding: 10px;
            text-align: left;
            border: 1px solid #e2e8f0;
        }
        th {
            background-color: #4f46e5;
            color: white;
            font-weight: bold;
        }
        tr:nth-child(even) {
            background-color: #f8fafc;
        }
        .criteria-list {
            list-style: decimal;
            padding-left: 25px;
        }
        .criteria-list li {
            margin: 8px 0;
            padding: 5px;
        }
        .inclusion-criteria {
            background-color: #ecfdf5;
            border-left: 4px solid #10b981;
            padding: 15px;
            margin: 15px 0;
        }
        .exclusion-criteria {
            background-color: #fef2f2;
            border-left: 4px solid #ef4444;
            padding: 15px;
            margin: 15px 0;
        }
        .stat-box {
            display: inline-block;
            background: #f8fafc;
            border: 1px solid #cbd5e1;
            padding: 15px 20px;
            margin: 10px;
            border-radius: 8px;
            min-width: 150px;
            text-align: center;
        }
        .stat-number {
            font-size: 32px;
            font-weight: bold;
            color: #4f46e5;
        }
        .stat-label {
            color: #64748b;
            font-size: 14px;
            margin-top: 5px;
        }
        .status-eligible { color: #10b981; font-weight: bold; }
        .status-ineligible { color: #ef4444; font-weight: bold; }
        .status-uncertain { color: #f59e0b; font-weight: bold; }
        @media print {
            body { padding: 20px; }
            .section { page-break-inside: avoid; }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Clinical Trial Comprehensive Report</h1>
        <div class="timestamp">Generated on: ${new Date().toLocaleString()}</div>
    </div>
`;

    // Trial Information
    if (sections.trialInfo && trial) {
        html += `
    <div class="section">
        <div class="section-title">Trial Information</div>
        <table>
            <tr><th>Field</th><th>Value</th></tr>
            <tr><td>Trial ID</td><td>${trial.trialId || 'N/A'}</td></tr>
            <tr><td>Protocol Title</td><td>${trial.protocolTitle || 'N/A'}</td></tr>
            <tr><td>Phase</td><td>${trial.phase || 'N/A'}</td></tr>
            <tr><td>Drug Name</td><td>${trial.drugName || 'N/A'}</td></tr>
            <tr><td>Indication</td><td>${trial.indication || 'N/A'}</td></tr>
            <tr><td>Status</td><td>${trial.status || 'N/A'}</td></tr>
        </table>
    </div>
`;
    }

    // FDA Forms
    if (sections.fdaForms) {
        try {
            const rulesRes = await apiClient.get(`/api/trials/${trial.trial_id || trial.trialId}/rules`);
            const fdaForms = rulesRes.data?.fda_forms || {};

            html += `<div class="section"><div class="section-title">FDA Forms</div>`;

            if (fdaForms.fda_1571) {
                html += `
                    <h3>Form FDA 1571 - IND Application</h3>
                    <table>
                        <tr><td><strong>Sponsor Name</strong></td><td>${fdaForms.fda_1571.sponsor_name || 'N/A'}</td></tr>
                        <tr><td><strong>Sponsor Address</strong></td><td>${fdaForms.fda_1571.sponsor_address || 'N/A'}</td></tr>
                        <tr><td><strong>IND Number</strong></td><td>${fdaForms.fda_1571.ind_number || 'N/A'}</td></tr>
                        <tr><td><strong>Drug Name</strong></td><td>${fdaForms.fda_1571.drug_name || 'N/A'}</td></tr>
                        <tr><td><strong>Phase</strong></td><td>${fdaForms.fda_1571.phase || 'N/A'}</td></tr>
                    </table>
                `;
            }

            if (fdaForms.fda_1572) {
                html += `
                    <h3>Form FDA 1572 - Statement of Investigator</h3>
                    <table>
                        <tr><td><strong>Investigator Name</strong></td><td>${fdaForms.fda_1572.investigator_name || 'N/A'}</td></tr>
                        <tr><td><strong>Institution</strong></td><td>${fdaForms.fda_1572.institution || 'N/A'}</td></tr>
                        <tr><td><strong>Department</strong></td><td>${fdaForms.fda_1572.department || 'N/A'}</td></tr>
                        <tr><td><strong>Address</strong></td><td>${fdaForms.fda_1572.address || 'N/A'}</td></tr>
                    </table>
                `;
            }

            html += `</div>`;
        } catch (err) {
            console.error('Error fetching FDA forms:', err);
        }
    }

    // Eligibility Criteria
    if (sections.eligibilityCriteria) {
        try {
            const rulesRes = await apiClient.get(`/api/trials/${trial.trial_id || trial.trialId}/rules`);
            const rules = rulesRes.data?.rules || [];

            const inclusionCriteria = rules.filter(r => r.type === 'inclusion');
            const exclusionCriteria = rules.filter(r => r.type === 'exclusion');

            html += `<div class="section"><div class="section-title">Eligibility Criteria</div>`;

            if (inclusionCriteria.length > 0) {
                html += `
                    <div class="inclusion-criteria">
                        <h3>Inclusion Criteria (${inclusionCriteria.length})</h3>
                        <ol class="criteria-list">
                            ${inclusionCriteria.map(c => `<li>${c.text || c.criterion_text || 'N/A'}</li>`).join('')}
                        </ol>
                    </div>
                `;
            }

            if (exclusionCriteria.length > 0) {
                html += `
                    <div class="exclusion-criteria">
                        <h3>Exclusion Criteria (${exclusionCriteria.length})</h3>
                        <ol class="criteria-list">
                            ${exclusionCriteria.map(c => `<li>${c.text || c.criterion_text || 'N/A'}</li>`).join('')}
                        </ol>
                    </div>
                `;
            }

            html += `</div>`;
        } catch (err) {
            console.error('Error fetching criteria:', err);
        }
    }

    // Patient Analysis
    if (sections.patientAnalysis && eligibilityResults && eligibilityResults.length > 0) {
        const eligible = eligibilityResults.filter(e =>
            e.status === 'ELIGIBLE' || e.eligibility_status?.includes('ELIGIBLE')
        ).length;
        const ineligible = eligibilityResults.filter(e =>
            e.status === 'INELIGIBLE' || e.eligibility_status === 'INELIGIBLE'
        ).length;
        const uncertain = eligibilityResults.length - eligible - ineligible;

        html += `
            <div class="section">
                <div class="section-title">Patient Screening Analysis</div>
                
                <div style="text-align: center; margin: 30px 0;">
                    <div class="stat-box">
                        <div class="stat-number">${eligibilityResults.length}</div>
                        <div class="stat-label">Total Screened</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-number" style="color: #10b981;">${eligible}</div>
                        <div class="stat-label">Eligible</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-number" style="color: #ef4444;">${ineligible}</div>
                        <div class="stat-label">Ineligible</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-number" style="color: #f59e0b;">${uncertain}</div>
                        <div class="stat-label">Uncertain</div>
                    </div>
                </div>

                <h3>Individual Patient Results</h3>
                <table>
                    <thead>
                        <tr>
                            <th>Patient ID</th>
                            <th>Status</th>
                            <th>Confidence</th>
                            <th>Criteria Met</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${eligibilityResults.slice(0, 100).map(result => {
            const status = result.status || result.eligibility_status || 'N/A';
            const statusClass = status.includes('ELIGIBLE') ? 'status-eligible' :
                status === 'INELIGIBLE' ? 'status-ineligible' : 'status-uncertain';
            const confidence = result.confidence ? (result.confidence * 100).toFixed(0) :
                result.confidence_score ? (result.confidence_score * 100).toFixed(0) : 'N/A';

            return `
                                <tr>
                                    <td>${result.patient_id || result.patientId || 'N/A'}</td>
                                    <td class="${statusClass}">${status}</td>
                                    <td>${confidence}%</td>
                                    <td>${result.criteria_met || 0}/${result.criteria_total || 0}</td>
                                </tr>
                            `;
        }).join('')}
                    </tbody>
                </table>
                ${eligibilityResults.length > 100 ? `<p style="color: #64748b; font-size: 14px;">Showing first 100 of ${eligibilityResults.length} patients</p>` : ''}
            </div>
        `;
    }

    html += `
</body>
</html>
`;

    return html;
};
